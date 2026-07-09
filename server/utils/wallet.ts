import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, startSpan, withScope } from "@sentry/node";
import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { env } from "node:process";
import { setTimeout } from "node:timers/promises";
import { nonEmpty, parse, pipe, rawTransform, regex, safeParse, string } from "valibot";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getContractError,
  http,
  InvalidInputRpcError,
  isHash,
  keccak256,
  RawContractError,
  rpcSchema,
  WaitForTransactionReceiptTimeoutError,
  withRetry,
  type Chain,
  type LocalAccount,
  type MaybePromise,
  type Prettify,
  type PublicActions,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
  type WriteContractParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import { dataSuffix } from "@exactly/common/attribution";
import chain from "@exactly/common/generated/chain";
import revertReason from "@exactly/common/revertReason";
import stack from "@exactly/common/stack";
import { Address, type Hash } from "@exactly/common/validation";

import nonceManager from "./nonceManager";
import defaultPublicClient, { captureRequests, Request, Requests } from "./publicClient";
import revertFingerprint from "./revertFingerprint";
import defaultTraceClient, { trace as traceActions, type RpcSchema } from "./traceClient";

import type { KeyManagementServiceClient } from "@google-cloud/kms";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");

export default function wallet(account: LocalAccount, network: Chain = chain) {
  const url = network.rpcUrls.alchemy?.http[0];
  if (!url) throw new Error("missing alchemy rpc url");
  const transport = http(`${url}/${alchemyAPIKey}`, {
    ...(network.id === chain.id && { batch: true }),
    async onFetchRequest(request) {
      const body: unknown = await request.clone().json();
      captureRequests(Array.isArray(body) ? parse(Requests, body) : [parse(Request, body)]);
    },
  });
  const publicClient = createPublicClient({
    chain: network,
    transport,
    rpcSchema: rpcSchema<RpcSchema>(),
  }).extend(traceActions);
  return createWalletClient({ chain: network, transport, account }).extend((client) => ({
    ...extender(client, { publicClient, traceClient: publicClient }),
    getCode: publicClient.getCode,
  }));
}

export function extender(
  keeper: WalletClient<Transport, Chain, LocalAccount>,
  {
    publicClient = defaultPublicClient,
    traceClient = defaultTraceClient,
  }: {
    publicClient?: Pick<
      PublicActions<Transport, Chain>,
      "sendRawTransaction" | "simulateContract" | "waitForTransactionReceipt"
    >;
    traceClient?: Pick<typeof defaultTraceClient, "traceTransaction">;
  } = {},
) {
  return {
    exaSend: async (
      spanOptions: Prettify<Omit<Parameters<typeof startSpan>[0], "name" | "op"> & { name: string; op: string }>,
      call: Prettify<Pick<WriteContractParameters, "abi" | "address" | "args" | "functionName">>,
      options?: {
        fees?: "auto";
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
              "tx.from": keeper.account.address,
              "tx.to": call.address,
            });
            const txOptions = {
              type: "eip1559",
              gas: 5_000_000n,
              ...(options?.fees !== "auto" && {
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000n,
              }),
            } as const;
            const { request: writeRequest } = await startSpan({ name: "eth_call", op: "tx.simulate" }, () =>
              publicClient.simulateContract({ account: keeper.account, dataSuffix, ...txOptions, ...call }),
            );
            const {
              abi: _,
              account: __,
              address: ___,
              ...request
            } = { from: writeRequest.account.address, to: writeRequest.address, ...writeRequest };
            scope.setContext("tx", { request });
            const data = encodeFunctionData(call);
            const prepared = await startSpan({ name: "prepare transaction", op: "tx.prepare" }, () =>
              keeper.prepareTransactionRequest({
                to: call.address,
                data: dataSuffix ? concatHex([data, dataSuffix]) : data,
                ...txOptions,
                nonceManager,
              }),
            );
            scope.setContext("tx", { request, prepared });
            span.setAttribute("tx.nonce", prepared.nonce);
            const serializedTransaction = await startSpan({ name: "sign transaction", op: "tx.sign" }, () =>
              keeper.signTransaction(prepared),
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
                        const info = nonceManager.info({ address: keeper.account.address, chainId: keeper.chain.id });
                        resetSpan.setAttribute("exa.reset", true);
                        resetSpan.setAttribute("exa.delta", info.delta);
                        resetSpan.setAttribute("exa.nonce", info.nonce);
                        nonceManager.hardReset({ address: keeper.account.address, chainId: keeper.chain.id });
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
            Promise.resolve(options?.onReceipt?.(receipt)).catch((error: unknown) =>
              captureException(error, { level: "error" }),
            );
            const trace = await startSpan({ name: "trace transaction", op: "tx.trace" }, () =>
              withRetry(() => traceClient.traceTransaction(hash), {
                delay: 1000,
                retryCount: 10,
                shouldRetry: ({ error }) => error instanceof InvalidInputRpcError,
              }).catch((error: unknown) => {
                captureException(error, { level: "error" });
                return null;
              }),
            );
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

export async function signer(name: string, kms: KeyManagementServiceClient): Promise<LocalAccount> {
  const account = await withRetry(
    async () =>
      gcpHsmToAccount({
        hsmKeyVersion: `projects/${parse(
          pipe(string(), regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/)),
          await kms.getProjectId(),
          { message: "invalid gcp project id" },
        )}/locations/${parse(pipe(string(), nonEmpty()), env.GCP_KMS_LOCATION, {
          message: "invalid GCP_KMS_LOCATION",
        })}/keyRings/${stack}-signers/cryptoKeys/${stack}-${name}/cryptoKeyVersions/${parse(
          pipe(string(), regex(/^\d+$/)),
          env[`GCP_KMS_KEY_VERSION_${name.toUpperCase()}`] || "1", // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty defaults
          { message: `invalid GCP_KMS_KEY_VERSION_${name.toUpperCase()}` },
        )}`,
        kmsClient: kms,
      }),
    {
      delay: 2000,
      retryCount: 3,
      shouldRetry: ({ error }) =>
        error instanceof Error &&
        (("code" in error &&
          ([4, 8, 13, 14].includes(Number(error.code)) ||
            ["DEADLINE_EXCEEDED", "INTERNAL", "RESOURCE_EXHAUSTED", "UNAVAILABLE"].includes(String(error.code)))) ||
          ["internal error", "network", "timeout", "unavailable"].some((value) =>
            error.message.toLowerCase().includes(value),
          ) ||
          ["NetworkError", "TimeoutError"].includes(error.name)),
    },
  );
  account.nonceManager = nonceManager;
  return account;
}

/** @deprecated remove with the monolith */
export function legacy(name: string) {
  return privateKeyToAccount(parse(PrivateKey, name), { nonceManager });
}

const PrivateKey = pipe(
  string(),
  rawTransform(({ addIssue, dataset, NEVER }) => {
    const name = dataset.value;
    const privateKey = env[`${name.toUpperCase()}_PRIVATE_KEY`];
    if (privateKey === undefined || !isHash(privateKey)) {
      addIssue({ message: `invalid ${name} private key` });
      return NEVER;
    }
    return privateKey;
  }),
);
