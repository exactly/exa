import { getActiveSpan } from "@sentry/node";
import { inspect } from "node:util";
import { array, object, optional, parse, string, unknown, type InferOutput } from "valibot";
import { createPublicClient, http, type Chain } from "viem";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

export default alchemyClient(chain);

export function alchemyClient<C extends Chain>(network: C) {
  const url = network.rpcUrls.alchemy?.http[0];
  if (!url) throw new Error("missing alchemy rpc url");
  return createPublicClient({
    chain: network,
    transport: http(`${url}/${alchemyAPIKey}`, {
      batch: true,
      async onFetchRequest(request) {
        captureRequests(parse(Requests, await request.json()));
      },
    }),
  });
}

export function captureRequests(requests: InferOutput<typeof Requests>) {
  const span = getActiveSpan();
  if (span) {
    for (const [index, { method, params }] of requests.entries()) {
      span.setAttribute(
        `eth[${Date.now()}]${requests.length > 1 ? `[${index}]` : ""}`,
        `${method}(${
          params
            ?.map((p) =>
              inspect(p, {
                colors: false,
                breakLength: Infinity,
                numericSeparator: true,
                maxStringLength: null,
                maxArrayLength: null,
                depth: null,
              }),
            )
            .join(", ") ?? ""
        })`,
      );
    }
  }
}

export const Request = object({ method: string(), params: optional(array(unknown())) });
export const Requests = array(Request);
