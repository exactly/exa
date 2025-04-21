import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { parse } from "valibot";
import { createPublicClient, http, type MaybePromise } from "viem";
import { vi } from "vitest";

import type * as publicClient from "../../utils/publicClient";

// eslint-disable-next-line import/prefer-default-export
export const onFetchResponse = vi.fn<(response: Response) => MaybePromise<void>>();

vi.mock("../../utils/publicClient", async (importOriginal) => {
  const original = await importOriginal<typeof publicClient>();
  return {
    ...original,
    default: createPublicClient({
      chain,
      transport: http(`${chain.rpcUrls.alchemy?.http[0]}/${alchemyAPIKey}`, {
        batch: true,
        async onFetchRequest(request) {
          original.captureRequests(parse(original.Requests, await request.json()));
        },
        onFetchResponse,
      }),
    }),
  };
});
