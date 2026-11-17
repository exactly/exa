import "../mocks/sentry";

import { startSpan } from "@sentry/node";
import { zeroAddress, type Client } from "viem";
import { describe, expect, it, vi } from "vitest";

import { createNonceManager } from "../../utils/nonceManager";

import type * as sentry from "@sentry/node";

describe("nonce manager", () => {
  it("skips a first nonce of zero still pending", async () => {
    const { startSpan: realStartSpan } = await vi.importActual<typeof sentry>("@sentry/node");
    const attributes: unknown[] = [];
    vi.mocked(startSpan).mockImplementation(((options, callback) =>
      realStartSpan(options, (span) => {
        const setAttribute = span.setAttribute.bind(span);
        span.setAttribute = (key, value) => {
          attributes.push([options.name, options.op, key, value]);
          return setAttribute(key, value);
        };
        return callback(span);
      })) as typeof startSpan);
    const source = { get: vi.fn(() => 0), set: vi.fn() };
    const manager = createNonceManager({ source });
    const parameters = { address: zeroAddress, chainId: 1, client: {} as Client };

    await expect(manager.consume(parameters)).resolves.toBe(0);
    await expect(manager.consume(parameters)).resolves.toBe(1);
    expect(source.get).toHaveBeenCalledTimes(2);
    expect(source.set.mock.calls).toStrictEqual([
      [{ address: zeroAddress, chainId: 1 }, 0],
      [{ address: zeroAddress, chainId: 1 }, 1],
    ]);
    const key = `${zeroAddress}.1`;
    expect(attributes).toStrictEqual(
      [0, 1].flatMap((consumed) => [
        ["consume nonce", "nonce.consume", "exa.key", key],
        ["get nonce", "nonce.get", "exa.key", key],
        ["get nonce", "nonce.get", "exa.promise", false],
        ["get nonce", "nonce.get", "exa.delta", undefined],
        ["increment nonce", "nonce.increment", "exa.key", key],
        ["increment nonce", "nonce.increment", "exa.delta", undefined],
        ["get nonce", "nonce.get", "exa.get", 0],
        ...(consumed
          ? [
              ["get nonce", "nonce.get", "exa.previousNonce", 0],
              ["get nonce", "nonce.get", "exa.internalNonce", 1],
            ]
          : [
              ["get nonce", "nonce.get", "exa.previousNonce", undefined],
              ["get nonce", "nonce.get", "exa.delete", true],
              ["get nonce", "nonce.get", "exa.nonce", 0],
            ]),
        ["reset nonce", "nonce.reset", "exa.key", key],
        ["reset nonce", "nonce.reset", "exa.delta", 1],
        ["reset nonce", "nonce.reset", "exa.promise", true],
        ["consume nonce", "nonce.consume", "exa.consume", consumed],
      ]),
    );
  });

  it("takes a source nonce newer than the cached one", async () => {
    const { startSpan: realStartSpan } = await vi.importActual<typeof sentry>("@sentry/node");
    const attributes: unknown[] = [];
    vi.mocked(startSpan).mockImplementation(((options, callback) =>
      realStartSpan(options, (span) => {
        const setAttribute = span.setAttribute.bind(span);
        span.setAttribute = (key, value) => {
          attributes.push([options.name, options.op, key, value]);
          return setAttribute(key, value);
        };
        return callback(span);
      })) as typeof startSpan);
    const source = { get: vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(1), set: vi.fn() };
    const manager = createNonceManager({ source });
    const parameters = { address: zeroAddress, chainId: 1, client: {} as Client };

    await expect(manager.consume(parameters)).resolves.toBe(0);
    attributes.length = 0;
    await expect(manager.consume(parameters)).resolves.toBe(1);
    expect(source.set.mock.calls).toStrictEqual([
      [{ address: zeroAddress, chainId: 1 }, 0],
      [{ address: zeroAddress, chainId: 1 }, 1],
    ]);
    const key = `${zeroAddress}.1`;
    expect(attributes).toStrictEqual([
      ["consume nonce", "nonce.consume", "exa.key", key],
      ["get nonce", "nonce.get", "exa.key", key],
      ["get nonce", "nonce.get", "exa.promise", false],
      ["get nonce", "nonce.get", "exa.delta", undefined],
      ["increment nonce", "nonce.increment", "exa.key", key],
      ["increment nonce", "nonce.increment", "exa.delta", undefined],
      ["get nonce", "nonce.get", "exa.get", 1],
      ["get nonce", "nonce.get", "exa.previousNonce", 0],
      ["get nonce", "nonce.get", "exa.delete", true],
      ["get nonce", "nonce.get", "exa.nonce", 1],
      ["reset nonce", "nonce.reset", "exa.key", key],
      ["reset nonce", "nonce.reset", "exa.delta", 1],
      ["reset nonce", "nonce.reset", "exa.promise", true],
      ["consume nonce", "nonce.consume", "exa.consume", 1],
    ]);
  });
});
