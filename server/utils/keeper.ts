import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { Hash } from "@exactly/common/validation";
import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, startSpan, withScope } from "@sentry/node";
import { parse } from "valibot";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  getContractError,
  http,
  nonceManager,
  RawContractError,
  type MaybePromise,
  type Prettify,
  type TransactionReceipt,
  type WriteContractParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import publicClient from "./publicClient";
import traceClient from "./traceClient";

if (!chain.rpcUrls.alchemy?.http[0]) throw new Error("missing alchemy rpc url");

export default createWalletClient({
  chain,
  transport: http(`${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`),
  account: privateKeyToAccount(
    parse(Hash, process.env.KEEPER_PRIVATE_KEY, {
      message: "invalid keeper private key",
    }),
    { nonceManager },
  ),
}).extend(extender);

export function extender(keeper: ReturnType<typeof createWalletClient>) {
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
            span.setAttributes({
              "tx.call": `${call.functionName}(${call.args?.map(String).join(", ") ?? ""})`,
              "tx.from": keeper.account?.address,
              "tx.to": call.address,
            });
            const { request: writeRequest } = await startSpan({ name: "eth_call", op: "tx.simulate" }, () =>
              publicClient.simulateContract({
                account: keeper.account,
                type: "eip1559",
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000n,
                gas: 5_000_000n,
                ...call,
              }),
            );
            const {
              abi: _,
              account: __,
              address: ___,
              ...request
            } = { from: writeRequest.account.address, to: writeRequest.address, ...writeRequest };
            scope.setContext("tx", { request });
            const hash = await startSpan({ name: "send transaction", op: "tx.send" }, () =>
              keeper.writeContract(writeRequest),
            );
            span.setAttribute("tx.hash", hash);
            scope.setContext("tx", { hash, request });
            await options?.onHash?.(hash);
            const receipt = await startSpan({ name: "wait for receipt", op: "tx.wait" }, () =>
              publicClient.waitForTransactionReceipt({ hash }),
            );
            span.setStatus({
              code: receipt.status === "success" ? SPAN_STATUS_OK : SPAN_STATUS_ERROR,
              message: receipt.status,
            });
            scope.setContext("tx", { hash, request, receipt });
            const trace = await traceClient.traceTransaction(hash);
            scope.setContext("tx", { hash, request, receipt, trace });
            if (receipt.status !== "success") {
              // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
              throw getContractError(new RawContractError({ data: trace.output }), { ...call, args: call.args ?? [] });
            }
            return receipt;
          } catch (error: unknown) {
            if (options?.ignore) {
              const reason =
                error instanceof BaseError &&
                error.cause instanceof ContractFunctionRevertedError &&
                error.cause.data?.errorName
                  ? `${error.cause.data.errorName}(${error.cause.data.args?.map(String).join(",") ?? ""})`
                  : error instanceof Error
                    ? error.message
                    : String(error);
              if (typeof options.ignore === "function") {
                const ignore = await options.ignore(reason);
                if (ignore === true) return null;
                if (ignore) return ignore;
              } else if (options.ignore.includes(reason)) return null;
            }
            span.setStatus({
              code: SPAN_STATUS_ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            captureException(error, { level: "error" });
            throw error;
          }
        }),
      ),
  };
}
