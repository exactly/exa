import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { Hash } from "@exactly/common/validation";
import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, startSpan, withScope } from "@sentry/node";
import { setTimeout } from "node:timers/promises";
import { parse } from "valibot";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  encodeFunctionData,
  getContractError,
  http,
  InvalidInputRpcError,
  keccak256,
  RawContractError,
  WaitForTransactionReceiptTimeoutError,
  withRetry,
  type HttpTransport,
  type MaybePromise,
  type Prettify,
  type PrivateKeyAccount,
  type TransactionReceipt,
  type WalletClient,
  type WriteContractParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import nonceManager from "./nonceManager";
import publicClient, { captureRequests, Requests } from "./publicClient";
import traceClient from "./traceClient";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");

export default createWalletClient({
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

export function extender(keeper: WalletClient<HttpTransport, typeof chain, PrivateKeyAccount>) {
  return {
    exaSend: async (
      spanOptions: Prettify<{ name: string; op: string } & Omit<Parameters<typeof startSpan>[0], "name" | "op">>,
      call: Prettify<Pick<WriteContractParameters, "address" | "functionName" | "args" | "abi">>,
      options?: {
        onHash?: (hash: Hash) => MaybePromise<unknown>;
        ignore?: string[] | ((reason: string) => MaybePromise<TransactionReceipt | boolean | undefined>);
      },
    ) =>
      withScope((scope) =>
        startSpan({ forceTransaction: true, ...spanOptions }, async (span) => {
          try {
            scope.setContext("tx", { call });
            span.setAttributes({
              "tx.call": `${call.functionName}(${call.args?.map(String).join(", ") ?? ""})`,
              "tx.from": keeper.account.address,
              "tx.to": call.address,
            });
            const txOptions = {
              type: "eip1559",
              maxFeePerGas: 1_000_000_000n,
              maxPriorityFeePerGas: 1_000_000n,
              gas: 5_000_000n,
            } as const;
            const { request: writeRequest } = await startSpan({ name: "eth_call", op: "tx.simulate" }, () =>
              publicClient.simulateContract({ account: keeper.account, ...txOptions, ...call }),
            );
            const {
              abi: _,
              account: __,
              address: ___,
              ...request
            } = { from: writeRequest.account.address, to: writeRequest.address, ...writeRequest };
            scope.setContext("tx", { request });
            const prepared = await startSpan({ name: "prepare transaction", op: "tx.prepare" }, () =>
              keeper.prepareTransactionRequest({
                to: call.address,
                data: encodeFunctionData(call),
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
                        const info = nonceManager.info({ address: keeper.account.address, chainId: chain.id });
                        resetSpan.setAttribute("exa.reset", true);
                        resetSpan.setAttribute("exa.delta", info.delta);
                        resetSpan.setAttribute("exa.nonce", info.nonce);
                        nonceManager.hardReset({ address: keeper.account.address, chainId: chain.id });
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
            const reason =
              error instanceof BaseError &&
              error.cause instanceof ContractFunctionRevertedError &&
              error.cause.data?.errorName
                ? `${error.cause.data.errorName}(${error.cause.data.args?.map(String).join(",") ?? ""})`
                : error instanceof Error
                  ? error.message
                  : String(error);
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
            captureException(error, { level: "error" });
            throw error;
          }
        }),
      ),
  };
}
