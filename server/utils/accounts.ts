import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, captureMessage, startSpan, withScope } from "@sentry/node";
import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { setTimeout } from "node:timers/promises";
import { parse, safeParse } from "valibot";
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getContractError,
  http,
  InvalidInputRpcError,
  keccak256,
  RawContractError,
  WaitForTransactionReceiptTimeoutError,
  withRetry,
  type HttpTransport,
  type LocalAccount,
  type MaybePromise,
  type Prettify,
  type PrivateKeyAccount,
  type TransactionReceipt,
  type WalletClient,
  type WriteContractParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, {
  auditorAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  firewallAbi,
  firewallAddress,
  marketAbi,
  upgradeableModularAccountAbi,
  wethAddress,
} from "@exactly/common/generated/chain";
import revertReason from "@exactly/common/revertReason";
import { Address, Hash } from "@exactly/common/validation";

import { GOOGLE_APPLICATION_CREDENTIALS, hasCredentials, initializeGcpCredentials, isRetryableKmsError } from "./gcp";
import nonceManager from "./nonceManager";
import { sendPushNotification } from "./onesignal";
import publicClient, { captureRequests, Requests } from "./publicClient";
import revertFingerprint from "./revertFingerprint";
import traceClient from "./traceClient";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");

if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required when using GCP KMS");
const projectId = process.env.GCP_PROJECT_ID;
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  throw new Error("GCP_PROJECT_ID must be a valid GCP project ID format");
}

if (!process.env.GCP_KMS_KEY_RING) throw new Error("GCP_KMS_KEY_RING is required when using GCP KMS");
const keyRing = process.env.GCP_KMS_KEY_RING;
if (!process.env.GCP_KMS_KEY_VERSION) throw new Error("GCP_KMS_KEY_VERSION is required when using GCP KMS");
const version = process.env.GCP_KMS_KEY_VERSION;
if (!/^\d+$/.test(version)) throw new Error("GCP_KMS_KEY_VERSION must be a numeric version number");

export const keeper = createWalletClient({
  chain,
  transport: http(`${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`, {
    batch: true,
    async onFetchRequest(request) {
      captureRequests(parse(Requests, await request.json()));
    },
  }),
  account: privateKeyToAccount(
    parse(Hash, process.env.KEEPER_PRIVATE_KEY, {
      message: "invalid keeper private key",
    }),
    { nonceManager },
  ),
}).extend(extender);

const ETH = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const WETH = parse(Address, wethAddress);

export function extender(client: WalletClient<HttpTransport, typeof chain, PrivateKeyAccount>) {
  const base = withExaSend(client);

  return {
    ...base,
    poke: async (
      accountAddress: Address,
      options?: { ignore?: string[]; notification?: { contents: { en: string }; headings: { en: string } } },
    ) => {
      const combinedAccountAbi = [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi];
      const marketsByAsset = await publicClient
        .readContract({ address: exaPreviewerAddress, functionName: "assets", abi: exaPreviewerAbi })
        .then((p) => new Map<Address, Address>(p.map((m) => [parse(Address, m.asset), parse(Address, m.market)])));

      const assetsToPoke: { asset: Address; market: Address | null }[] = [];

      const settled = await Promise.allSettled([
        publicClient
          .getBalance({ address: accountAddress })
          .then((balance): { asset: Address; balance: bigint; market: Address | null } => ({
            asset: ETH,
            market: null,
            balance,
          })),
        ...[...marketsByAsset.entries()].map(async ([asset, market]) => ({
          asset,
          market,
          balance: await publicClient.readContract({
            address: asset,
            functionName: "balanceOf",
            args: [accountAddress],
            abi: erc20Abi,
          }),
        })),
      ]).then((s) => {
        return s.flatMap((result) => {
          if (result.status === "rejected") {
            captureException(result.reason, { level: "error" });
            return [];
          }
          return [result.value];
        });
      });

      const hasETH = settled.some((r) => r.asset === ETH && r.balance > 0n);
      for (const { asset, market, balance } of settled) {
        if (hasETH && asset === WETH) continue;
        if (balance > 0n) assetsToPoke.push({ asset, market });
      }

      const pokes = await Promise.allSettled(
        assetsToPoke.map(({ asset, market }) =>
          base.exaSend(
            {
              name: "poke account",
              op: "exa.poke",
              attributes: { account: accountAddress, asset },
            },
            asset === ETH
              ? {
                  address: accountAddress,
                  abi: combinedAccountAbi,
                  functionName: "pokeETH",
                }
              : {
                  address: accountAddress,
                  abi: combinedAccountAbi,
                  functionName: "poke",
                  args: [market],
                },
            ...(options?.ignore ? [{ ignore: options.ignore }] : []),
          ),
        ),
      ).then((r) => {
        return r.flatMap((result) => {
          if (result.status === "rejected") {
            captureException(result.reason, { level: "error" });
            return [];
          }

          return result.value ?? [];
        });
      });

      if (options?.notification && pokes.length > 0) {
        sendPushNotification({
          userId: accountAddress,
          headings: options.notification.headings,
          contents: options.notification.contents,
        }).catch((error: unknown) => captureException(error, { level: "error" }));
      }
    },
  };
}

export function withExaSend(
  client: WalletClient<HttpTransport, typeof chain, LocalAccount> & {
    account: LocalAccount;
  },
) {
  return {
    exaSend: async (
      spanOptions: Prettify<Omit<Parameters<typeof startSpan>[0], "name" | "op"> & { name: string; op: string }>,
      call: Prettify<Pick<WriteContractParameters, "abi" | "address" | "args" | "functionName">>,
      options?: {
        ignore?: ((reason: string) => MaybePromise<boolean | TransactionReceipt | undefined>) | string[];
        level?: "error" | "warning" | ((reason: string, error: unknown) => "error" | "warning" | false) | false;
        onHash?: (hash: Hash) => MaybePromise<unknown>;
        onReceipt?: (receipt: TransactionReceipt) => MaybePromise<unknown>;
      },
    ) =>
      withScope((scope) =>
        startSpan({ forceTransaction: true, ...spanOptions }, async (span) => {
          const account = safeParse(Address, spanOptions.attributes?.account);
          if (account.success) scope.setUser({ id: account.output });
          try {
            scope.setContext("tx", { call });
            span.setAttributes({
              "tx.call": `${call.functionName}(${call.args?.map(String).join(", ") ?? ""})`,
              "tx.from": client.account.address,
              "tx.to": call.address,
            });
            const txOptions = {
              type: "eip1559",
              maxFeePerGas: 1_000_000_000n,
              maxPriorityFeePerGas: 1_000_000n,
              gas: 5_000_000n,
            } as const;
            const { request: writeRequest } = await startSpan({ name: "eth_call", op: "tx.simulate" }, () =>
              publicClient.simulateContract({ account: client.account, ...txOptions, ...call }),
            );
            const {
              abi: _,
              account: __,
              address: ___,
              ...request
            } = { from: writeRequest.account.address, to: writeRequest.address, ...writeRequest };
            scope.setContext("tx", { request });
            const prepared = await startSpan({ name: "prepare transaction", op: "tx.prepare" }, () =>
              client.prepareTransactionRequest({
                to: call.address,
                data: encodeFunctionData(call),
                ...txOptions,
                nonceManager,
              }),
            );
            scope.setContext("tx", { request, prepared });
            span.setAttribute("tx.nonce", prepared.nonce);
            const serializedTransaction = await startSpan({ name: "sign transaction", op: "tx.sign" }, () =>
              client.signTransaction(prepared),
            );
            const hash = keccak256(serializedTransaction);
            scope.setContext("tx", { request, prepared, hash });
            span.setAttribute("tx.hash", hash);
            const abortController = new AbortController();
            const [, receiptResult] = await Promise.allSettled([
              (async () => {
                while (!abortController.signal.aborted) {
                  await Promise.allSettled([
                    startSpan({ name: "send transaction", op: "tx.send" }, () =>
                      publicClient.sendRawTransaction({ serializedTransaction }),
                    ).catch((error: unknown) => {
                      captureException(error, { level: "error" });
                      throw error;
                    }),
                    setTimeout(10_000, null, { signal: abortController.signal }),
                  ]);
                }
              })(),
              startSpan({ name: "wait for receipt", op: "tx.wait" }, () =>
                publicClient.waitForTransactionReceipt({ hash, confirmations: 0 }),
              )
                .catch((error: unknown) => {
                  if (error instanceof WaitForTransactionReceiptTimeoutError) {
                    startSpan(
                      { name: "nonce reset", op: "tx.reset", attributes: { "tx.nonce": prepared.nonce } },
                      (resetSpan) => {
                        const info = nonceManager.info({ address: client.account.address, chainId: chain.id });
                        resetSpan.setAttribute("exa.reset", true);
                        resetSpan.setAttribute("exa.delta", info.delta);
                        resetSpan.setAttribute("exa.nonce", info.nonce);
                        nonceManager.hardReset({ address: client.account.address, chainId: chain.id });
                      },
                    );
                  }
                  throw error;
                })
                .finally(() => {
                  abortController.abort();
                }),
              Promise.resolve(options?.onHash?.(hash)).catch((error: unknown) =>
                captureException(error, { level: "error" }),
              ),
            ]);
            if (receiptResult.status === "rejected") throw receiptResult.reason;
            const receipt = receiptResult.value;
            scope.setContext("tx", { request, receipt });
            const [trace] = await Promise.all([
              startSpan({ name: "trace transaction", op: "tx.trace" }, () =>
                withRetry(() => traceClient.traceTransaction(hash), {
                  delay: 1000,
                  retryCount: 10,
                  shouldRetry: ({ error }) => error instanceof InvalidInputRpcError,
                }).catch((error: unknown) => {
                  captureException(error, { level: "error" });
                  return null;
                }),
              ),
              Promise.resolve(options?.onReceipt?.(receipt)).catch((error: unknown) =>
                captureException(error, { level: "error" }),
              ),
            ]);
            scope.setContext("tx", { request, receipt, trace });
            if (receipt.status !== "success") {
              if (!trace) throw new Error("no trace");
              // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
              throw getContractError(new RawContractError({ data: trace.output }), { ...call, args: call.args ?? [] });
            }
            span.setStatus({ code: SPAN_STATUS_OK });
            return receipt;
          } catch (error: unknown) {
            const reason = revertReason(error, { fallback: "message", withArguments: true });
            if (options?.ignore) {
              const ignore =
                typeof options.ignore === "function" ? await options.ignore(reason) : options.ignore.includes(reason);
              if (ignore) {
                span.setAttribute("exa.error", reason);
                span.setStatus({ code: SPAN_STATUS_OK });
                return ignore === true ? null : ignore;
              }
            }
            span.setStatus({ code: SPAN_STATUS_ERROR, message: reason });
            const level =
              typeof options?.level === "function" ? options.level(reason, error) : (options?.level ?? "error");
            if (level) {
              withScope((captureScope) => {
                const fingerprint = revertFingerprint(error);
                if (fingerprint[1] && fingerprint[1] !== "unknown") {
                  const type = fingerprint.length > 2 ? `${fingerprint[1]}(${fingerprint[2]})` : fingerprint[1];
                  captureScope.addEventProcessor((event) => {
                    if (event.exception?.values?.[0]) event.exception.values[0].type = type;
                    return event;
                  });
                }
                captureException(error, { level, fingerprint });
              });
            }
            throw error;
          }
        }),
      ),
  };
}

export async function getAccount(): Promise<LocalAccount> {
  await initializeGcpCredentials();

  if (!(await hasCredentials())) {
    throw new Error(
      `gcp credentials file not found at ${GOOGLE_APPLICATION_CREDENTIALS}. ` +
        `ensure GCP_BASE64_JSON environment variable is set.`,
    );
  }

  try {
    const account = await withRetry(
      () =>
        gcpHsmToAccount({
          hsmKeyVersion: `projects/${projectId}/locations/us-west2/keyRings/${keyRing}/cryptoKeys/allower/cryptoKeyVersions/${version}`,
          kmsClient: new KeyManagementServiceClient({
            keyFilename: GOOGLE_APPLICATION_CREDENTIALS,
          }),
        }),
      {
        delay: 2000,
        retryCount: 3,
        shouldRetry: ({ error }) => isRetryableKmsError(error),
      },
    );

    account.nonceManager = nonceManager;
    return account;
  } catch (error: unknown) {
    captureException(error, { level: "error" });
    throw error;
  }
}

export async function allower() {
  return createWalletClient({
    chain,
    transport: http(`${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`, {
      batch: true,
      async onFetchRequest(request) {
        try {
          captureRequests(parse(Requests, await request.clone().json()));
        } catch (error: unknown) {
          captureMessage("failed to parse or capture rpc requests", {
            level: "error",
            extra: { error },
          });
        }
      },
    }),
    account: await getAccount(),
  }).extend((client: WalletClient<HttpTransport, typeof chain, LocalAccount>) => {
    const base = withExaSend(client);
    return {
      ...base,
      allow: async (account: Address, options?: { ignore?: string[] }) => {
        if (!firewallAddress) throw new Error("firewall address not configured");
        return base.exaSend(
          { forceTransaction: true, name: "firewall.allow", op: "exa.firewall", attributes: { account } },
          {
            address: firewallAddress,
            functionName: "allow",
            args: [account, true],
            abi: firewallAbi,
          },
          options?.ignore ? { ignore: options.ignore } : undefined,
        );
      },
    };
  });
}
