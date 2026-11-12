import { BaseError, createPublicClient, erc20Abi, http, zeroAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import rpcFingerprint from "@exactly/common/rpcFingerprint";

const client = createPublicClient({ transport: http("https://rpc.test", { retryCount: 0 }) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rpc fingerprint", () => {
  it.each([
    [
      -32_603,
      "archive state missing",
      ["InternalRpcError", "An internal error was received.", "archive state missing"],
    ],
    [
      -32_603,
      "upstream service overloaded",
      ["InternalRpcError", "An internal error was received.", "upstream service overloaded"],
    ],
    [
      -32_005,
      "Too many requests, reason: call rate limit exhausted, retry in 10m0s",
      [
        "LimitExceededRpcError",
        "Request exceeds defined limit.",
        "Too many requests, reason: call rate limit exhausted, retry in 0m0s",
      ],
    ],
    [
      -32_099,
      "Temporary internal error. Please retry, trace-id: 338295e5b960f89e490e5c2b17cf822c",
      ["RpcRequestError", "RPC Request failed.", "Temporary internal error. Please retry, trace-id: <id>"],
    ],
  ])("keeps provider details of %i %s", async (code, message, fingerprint) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ jsonrpc: "2.0", id: 0, error: { code, message } })),
    );

    const [request, read] = await Promise.all([
      client.request({ method: "eth_blockNumber" }).catch((error: unknown) => error),
      client
        .readContract({ address: zeroAddress, abi: erc20Abi, functionName: "totalSupply" })
        .catch((error: unknown) => error),
    ]);

    expect(rpcFingerprint(request)).toStrictEqual(fingerprint);
    expect(rpcFingerprint(read)).toStrictEqual(fingerprint);
  });

  it.each([
    [
      -32_603,
      "Internal error: request 3f2a9c1e-77b1-4c2d-9e0f-1a2b3c4d5e6f failed",
      "Internal error: request <id> failed",
    ],
    [-32_603, "AA23 reverted (or OOG)", "AA23 reverted (or OOG)"],
  ])("normalizes provider details of %i %s", async (code, message, details) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ jsonrpc: "2.0", id: 0, error: { code, message } })),
    );

    const error = await client.request({ method: "eth_blockNumber" }).catch((error_: unknown) => error_);

    expect(rpcFingerprint(error)).toStrictEqual(["InternalRpcError", "An internal error was received.", details]);
  });

  it.each([
    [3, "execution reverted", undefined],
    [3, "execution reverted", "0x"],
    [3, "execution reverted", "0x8baa579f"],
    [-32_000, "execution reverted", undefined],
    [-32_603, "execution reverted", undefined],
    [-32_603, "internal error", "0x"],
  ])("leaves reverts of %i %s %s to revert reasons", async (code, message, data) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        Response.json({ jsonrpc: "2.0", id: 0, error: { code, message, ...(data === undefined ? {} : { data }) } }),
      ),
    );

    const error = await client
      .readContract({ address: zeroAddress, abi: erc20Abi, functionName: "totalSupply" })
      .catch((error_: unknown) => error_);

    expect(rpcFingerprint(error)).toBeUndefined();
  });

  it("keeps the status of http failures", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("unauthorized", { status: 401 })),
    );

    const error = await client
      .readContract({ address: zeroAddress, abi: erc20Abi, functionName: "totalSupply" })
      .catch((error_: unknown) => error_);

    expect(rpcFingerprint(error)).toStrictEqual(["HttpRequestError", "HTTP request failed.", "401"]);
  });

  it("keeps http failures without status", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const error = await client.request({ method: "eth_blockNumber" }).catch((error_: unknown) => error_);

    expect(rpcFingerprint(error)).toStrictEqual(["HttpRequestError", "HTTP request failed."]);
  });

  it("keeps rpc failures without details", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ jsonrpc: "2.0", id: 0, error: { code: -32_603, message: "" } })),
    );

    const error = await client.request({ method: "eth_blockNumber" }).catch((error_: unknown) => error_);

    expect(rpcFingerprint(error)).toStrictEqual(["InternalRpcError", "An internal error was received."]);
  });

  it("keeps timeouts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const error = await createPublicClient({ transport: http("https://rpc.test", { retryCount: 0, timeout: 1 }) })
      .request({ method: "eth_blockNumber" })
      .catch((error_: unknown) => error_);

    expect(rpcFingerprint(error)).toStrictEqual([
      "TimeoutError",
      "The request took too long to respond.",
      "The request timed out.",
    ]);
  });

  it("ignores other errors", () => {
    expect(rpcFingerprint(new Error("other"))).toBeUndefined();
    expect(rpcFingerprint(new BaseError("other"))).toBeUndefined();
  });
});
