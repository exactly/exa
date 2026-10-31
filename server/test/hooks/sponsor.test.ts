import "../mocks/sentry";

import { captureException, setContext, setExtra, setUser, startSpan } from "@sentry/node";
import { hexToBigInt, hexToBytes, numberToHex, padHex, zeroAddress, zeroHash, type Hex } from "viem";
import { entryPoint06Address, entryPoint07Address } from "viem/account-abstraction";
import { privateKeyToAddress } from "viem/accounts";
import { anvil, moonbeamDev } from "viem/chains";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import database, { credentials } from "../../database";
import createSponsorHook from "../../hooks/sponsor";
import publicClient from "../../utils/publicClient";

import type * as sentry from "@sentry/node";

const token = "sponsor-token";
const { app } = createSponsorHook({ database, token });

describe("sponsor hook", () => {
  const owner = privateKeyToAddress(padHex("0x5905"));
  const wallet = privateKeyToAddress(padHex("0x5906"));
  const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner), y: zeroHash });
  let spans: Map<string, Record<string, unknown>>;

  beforeAll(async () => {
    await database.insert(credentials).values([
      { id: "sponsor-test", publicKey: new Uint8Array(hexToBytes(owner)), account, factory: exaAccountFactoryAddress },
      {
        id: wallet,
        publicKey: new Uint8Array(hexToBytes(wallet)),
        account: deriveAddress(exaAccountFactoryAddress, { x: padHex(wallet), y: zeroHash }),
        factory: exaAccountFactoryAddress,
      },
    ]);
  });

  beforeEach(async () => {
    spans = await spySpans();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("approves an exa account", async () => {
    const gasPrice = await publicClient.getGasPrice();
    const request = bundler(70_000n, gasPrice);
    const response = await sponsor({ chainId: anvil.id, sender: account.toLowerCase(), maxFeePerGas: gasPrice });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: true });
    expect(request).toHaveBeenCalledWith({
      method: "eth_estimateUserOperationGas",
      params: [{ ...operation(account, gasPrice, 0n), sender: account, callGasLimit: "0x0" }, entryPoint06Address],
    });
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(setContext).toHaveBeenCalledWith("sponsor", {
      chainId: anvil.id,
      policyId: "anvil",
      userOperation: { ...operation(account, gasPrice), sender: account },
    });
    expect(Object.fromEntries(spans)).toStrictEqual({
      sponsor: {
        "sponsor.chain": anvil.id,
        "sponsor.sender": account,
        "sponsor.entrypoint": entryPoint06Address,
        "sponsor.callGasLimit": 390_625,
        "sponsor.maxFeePerGas": Number(gasPrice),
        "sponsor.maxPriorityFeePerGas": Number(gasPrice),
        "sponsor.paymasterPostOpGasLimit": 0,
        "sponsor.preVerificationGas": 70_000,
        "sponsor.signature.size": 0,
        "sponsor.approved": true,
      },
      "find sender": { "sponsor.known": true },
      eth_gasPrice: expect.objectContaining({
        "sponsor.gasPrice": expect.any(Number) as unknown,
        "sponsor.gasPrice.ratio": expect.any(Number) as unknown,
      }) as unknown,
      "priority fee": {
        "sponsor.priorityFee.network": expect.any(Number) as unknown,
        "sponsor.priorityFee.bundler": Number(gasPrice),
        "sponsor.priorityFee.ratio": 1,
      },
      eth_estimateUserOperationGas: {
        "sponsor.estimate": 70_000,
        "sponsor.estimate.ratio": 1,
        "sponsor.estimate.callGasLimit": 200_000,
        "sponsor.estimate.callGasLimit.ratio": 390_625 / 200_000,
      },
    });
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "sponsor", op: "sponsor.check" }),
      expect.any(Function),
    );
    expect(startSpan).toHaveBeenCalledWith({ name: "find sender", op: "sponsor.sender" }, expect.any(Function));
    expect(startSpan).toHaveBeenCalledWith({ name: "eth_gasPrice", op: "sponsor.gasPrice" }, expect.any(Function));
    expect(startSpan).toHaveBeenCalledWith({ name: "priority fee", op: "sponsor.priorityFee" }, expect.any(Function));
    expect(startSpan).toHaveBeenCalledWith(
      { name: "eth_estimateUserOperationGas", op: "sponsor.estimate" },
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("approves the owner wallet of an exa account on entrypoint v0.7", async () => {
    const gasPrice = await publicClient.getGasPrice();
    const request = bundler(140_000n, gasPrice);
    const { initCode, paymasterAndData, ...userOperation } = operation(wallet, gasPrice, 280_000n);
    const response = await sponsor({ chainId: numberToHex(anvil.id), userOperation });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: true });
    expect(initCode).toBe("0x");
    expect(paymasterAndData).toBe("0x");
    expect(request).toHaveBeenCalledWith({
      method: "eth_estimateUserOperationGas",
      params: [{ ...userOperation, preVerificationGas: "0x0", callGasLimit: "0x0" }, entryPoint07Address],
    });
    expect(spans.get("sponsor")).toStrictEqual({
      "sponsor.chain": anvil.id,
      "sponsor.sender": wallet,
      "sponsor.entrypoint": entryPoint07Address,
      "sponsor.callGasLimit": 390_625,
      "sponsor.maxFeePerGas": Number(gasPrice),
      "sponsor.maxPriorityFeePerGas": Number(gasPrice),
      "sponsor.paymasterPostOpGasLimit": 0,
      "sponsor.preVerificationGas": 280_000,
      "sponsor.signature.size": 0,
      "sponsor.approved": true,
    });
    expect(spans.get("eth_estimateUserOperationGas")).toStrictEqual({
      "sponsor.estimate": 140_000,
      "sponsor.estimate.ratio": 2,
      "sponsor.estimate.callGasLimit": 200_000,
      "sponsor.estimate.callGasLimit.ratio": 390_625 / 200_000,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["v0.6", "0x"],
    ["v0.7", undefined],
  ])("approves a stub request without a signature on entrypoint %s without estimating it", async (_, initCode) => {
    const request = bundler();
    const response = await sponsor({
      chainId: String(anvil.id),
      userOperation: { ...operation(account, 0n, 0n), initCode, callGasLimit: "0x0", signature: undefined },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: true });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_estimateUserOperationGas" }));
    expect(spans.has("eth_estimateUserOperationGas")).toBe(false);
    expect(spans.get("sponsor")).toMatchObject({
      "sponsor.preVerificationGas": 0,
      "sponsor.signature.size": 0,
      "sponsor.approved": true,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("denies an unknown sender before any network call", async () => {
    const sender = privateKeyToAddress(padHex("0x5907"));
    const response = await sponsor({ chainId: anvil.id, sender, maxFeePerGas: await publicClient.getGasPrice() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("find sender")).toStrictEqual({ "sponsor.known": false });
    expect(spans.has("eth_gasPrice")).toBe(false);
    expect(spans.has("priority fee")).toBe(false);
    expect(spans.has("eth_estimateUserOperationGas")).toBe(false);
    expect(spans.get("sponsor")).toMatchObject({ "sponsor.approved": false, "sponsor.reason": "unknown sender" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("unknown sender"), {
      level: "warning",
      extra: { chainId: anvil.id, sender },
    });
  });

  it("denies an operation the bundler rejects", async () => {
    bundler();
    const response = await sponsor({ chainId: anvil.id, sender: account, maxFeePerGas: 1n });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("eth_estimateUserOperationGas")).toStrictEqual({
      "sponsor.estimate.error": expect.any(String) as unknown,
    });
    expect(spans.get("sponsor")).toMatchObject({
      "sponsor.approved": false,
      "sponsor.reason": "rejected operation",
    });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("rejected operation"), {
      level: "warning",
      extra: { chainId: anvil.id, sender: account, error: expect.any(String) as unknown },
    });
  });

  it("denies a fee far above the network", async () => {
    bundler(70_000n);
    const maxFeePerGas = 100n * (await publicClient.getGasPrice());
    const response = await sponsor({ chainId: anvil.id, sender: account, maxFeePerGas });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("sponsor")).toMatchObject({ "sponsor.approved": false, "sponsor.reason": "excessive fee" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("excessive fee"), {
      level: "warning",
      extra: {
        chainId: anvil.id,
        sender: account,
        maxFeePerGas: String(maxFeePerGas),
        gasPrice: expect.any(String) as unknown,
      },
    });
  });

  it("approves a tip far above the network that the bundler asks for", async () => {
    const gasPrice = await publicClient.getGasPrice();
    const priorityFee = hexToBigInt(await publicClient.request({ method: "eth_maxPriorityFeePerGas" }));
    const maxPriorityFeePerGas = 2n * priorityFee;
    bundler(70_000n, maxPriorityFeePerGas);
    const response = await sponsor({
      chainId: anvil.id,
      userOperation: { ...operation(account, gasPrice), maxPriorityFeePerGas: numberToHex(maxPriorityFeePerGas) },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: true });
    expect(spans.get("priority fee")).toStrictEqual({
      "sponsor.priorityFee.network": Number(priorityFee),
      "sponsor.priorityFee.bundler": Number(maxPriorityFeePerGas),
      "sponsor.priorityFee.ratio": 1,
    });
    expect(spans.get("sponsor")).toMatchObject({ "sponsor.approved": true });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("denies a tip far above both the network and the bundler", async () => {
    const gasPrice = await publicClient.getGasPrice();
    const priorityFee = hexToBigInt(await publicClient.request({ method: "eth_maxPriorityFeePerGas" }));
    bundler(70_000n, priorityFee / 2n);
    const maxPriorityFeePerGas = 2n * priorityFee;
    const response = await sponsor({
      chainId: anvil.id,
      userOperation: { ...operation(account, gasPrice), maxPriorityFeePerGas: numberToHex(maxPriorityFeePerGas) },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("priority fee")).toStrictEqual({
      "sponsor.priorityFee.network": Number(priorityFee),
      "sponsor.priorityFee.bundler": Number(priorityFee / 2n),
      "sponsor.priorityFee.ratio": 2,
    });
    expect(spans.get("sponsor")).toMatchObject({ "sponsor.approved": false, "sponsor.reason": "excessive tip" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("excessive tip"), {
      level: "warning",
      extra: {
        chainId: anvil.id,
        sender: account,
        maxPriorityFeePerGas: String(maxPriorityFeePerGas),
        network: String(priorityFee),
        bundler: String(priorityFee / 2n),
      },
    });
  });

  it("denies pre-verification gas far above the bundler estimate", async () => {
    const gasPrice = await publicClient.getGasPrice();
    bundler(30_000n, gasPrice);
    const response = await sponsor({ chainId: anvil.id, sender: account, maxFeePerGas: gasPrice, gas: 70_000n });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("eth_estimateUserOperationGas")).toStrictEqual({
      "sponsor.estimate": 30_000,
      "sponsor.estimate.ratio": 70_000 / 30_000,
      "sponsor.estimate.callGasLimit": 200_000,
      "sponsor.estimate.callGasLimit.ratio": 390_625 / 200_000,
    });
    expect(spans.get("sponsor")).toMatchObject({
      "sponsor.approved": false,
      "sponsor.reason": "excessive pre-verification gas",
    });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("excessive pre-verification gas"), {
      level: "warning",
      extra: { chainId: anvil.id, sender: account, preVerificationGas: "70000", estimate: "30000" },
    });
  });

  it.each([
    ["v0.6", "0x", entryPoint06Address],
    ["v0.7", undefined, entryPoint07Address],
  ])(
    "denies call gas far above the bundler estimate on entrypoint %s even without pre-verification gas",
    async (_, initCode, entryPoint) => {
      const gasPrice = await publicClient.getGasPrice();
      const request = bundler(30_000n, gasPrice, 100_000n);
      const userOperation = { ...operation(wallet, gasPrice, 0n), initCode };
      const response = await sponsor({
        chainId: anvil.id,
        userOperation: { ...userOperation, callGasLimit: numberToHex(8_000_000n) },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ approved: false });
      expect(request).toHaveBeenCalledWith({
        method: "eth_estimateUserOperationGas",
        params: [{ ...userOperation, preVerificationGas: "0x0", callGasLimit: "0x0" }, entryPoint],
      });
      expect(spans.get("eth_estimateUserOperationGas")).toMatchObject({
        "sponsor.estimate.callGasLimit": 100_000,
        "sponsor.estimate.callGasLimit.ratio": 80,
      });
      expect(spans.get("sponsor")).toMatchObject({ "sponsor.approved": false, "sponsor.reason": "excessive call gas" });
      expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("excessive call gas"), {
        level: "warning",
        extra: { chainId: anvil.id, sender: wallet, callGasLimit: "8000000", estimate: "100000" },
      });
    },
  );

  it("denies a signature longer than any real one before any network call", async () => {
    const response = await sponsor({
      chainId: anvil.id,
      userOperation: { ...operation(account, 1n), signature: `0x${"ff".repeat(2049)}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.has("find sender")).toBe(false);
    expect(spans.get("sponsor")).toMatchObject({
      "sponsor.signature.size": 2049,
      "sponsor.approved": false,
      "sponsor.reason": "excessive signature",
    });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("excessive signature"), {
      level: "warning",
      extra: { chainId: anvil.id, sender: account, signatureSize: 2049 },
    });
  });

  it("denies a check that outlasts the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { promise: estimating, resolve } = Promise.withResolvers<unknown>();
    const request = publicClient.request;
    vi.spyOn(publicClient, "request").mockImplementation(((parameters: Parameters<typeof request>[0], options) => {
      if ((parameters as { method: string }).method !== "eth_estimateUserOperationGas") {
        return request(parameters, options);
      }
      resolve(parameters);
      return new Promise(() => undefined);
    }) as typeof publicClient.request);
    const pending = sponsor({ chainId: anvil.id, sender: account, maxFeePerGas: 1n });
    await estimating;
    await vi.advanceTimersByTimeAsync(3000);
    const response = await pending;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("sponsor")).toMatchObject({ "sponsor.approved": false, "sponsor.reason": "slow check" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("slow check"), {
      level: "warning",
      extra: { chainId: anvil.id, sender: account },
    });
  });

  it("denies post-op gas above what the alchemy paymaster asks for before any network call", async () => {
    const { initCode, ...userOperation } = operation(wallet, 1n);
    const response = await sponsor({
      chainId: anvil.id,
      userOperation: { ...userOperation, paymasterPostOpGasLimit: numberToHex(75_001n) },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.has("find sender")).toBe(false);
    expect(spans.get("sponsor")).toMatchObject({
      "sponsor.paymasterPostOpGasLimit": 75_001,
      "sponsor.approved": false,
      "sponsor.reason": "excessive post-op gas",
    });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("excessive post-op gas"), {
      level: "warning",
      extra: { chainId: anvil.id, sender: wallet, paymasterPostOpGasLimit: "75001" },
    });
  });

  it("denies an unsupported chain", async () => {
    const response = await sponsor({ chainId: 4337, sender: account, maxFeePerGas: 0n });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("sponsor")).toMatchObject({ "sponsor.approved": false, "sponsor.reason": "unsupported chain" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("unsupported chain"), {
      level: "warning",
      extra: { chainId: 4337, sender: account },
    });
  });

  it("fails when another chain can't be reached", async () => {
    const response = await sponsor({ chainId: moonbeamDev.id, sender: account, maxFeePerGas: 1n });

    expect(response.status).toBe(500);
    expect(spans.get("sponsor")).not.toHaveProperty("sponsor.approved");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("fails when the bundler estimate is malformed", async () => {
    bundler(null);
    const response = await sponsor({
      chainId: anvil.id,
      sender: account,
      maxFeePerGas: await publicClient.getGasPrice(),
    });

    expect(response.status).toBe(500);
    expect(spans.get("sponsor")).not.toHaveProperty("sponsor.approved");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("refuses to start without a token", () => {
    expect(() => createSponsorHook({ database, token: "" })).toThrow("missing sponsor token");
  });

  it.each([
    ["without a token", "/"],
    ["with a longer token", "/?token=sponsor-tokens"],
    ["with a wrong token of the same length", "/?token=sponsor-taken"],
  ])("denies a request %s before any work", async (_, path) => {
    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId: anvil.id, policyId: "anvil", userOperation: operation(account, 1n) }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.size).toBe(0);
    expect(setExtra).toHaveBeenCalledExactlyOnceWith("exa.ignore", true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    [
      "without gas fields",
      { sender: zeroAddress },
      Object.fromEntries(
        ["callGasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "preVerificationGas"].map((key) => [
          `userOperation.${key}`,
          [`Invalid key: Expected "${key}" but received undefined`],
        ]),
      ),
    ],
    [
      "with an empty fee",
      { ...operation(zeroAddress, 1n), maxFeePerGas: "0x" },
      { "userOperation.maxFeePerGas": ["bad quantity"] },
    ],
  ])("denies a malformed operation %s", async (_, userOperation, nested) => {
    const response = await sponsor({ chainId: anvil.id, userOperation });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.size).toBe(0);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("bad sponsor"), {
      fingerprint: ["{{ default }}", "bad sponsor"],
      contexts: { validation: expect.objectContaining({ success: false, flatten: { nested } }) as unknown },
    });
  });
});

function operation(sender: string, maxFeePerGas: bigint, gas = 70_000n) {
  return {
    sender,
    nonce: "0x0",
    initCode: "0x",
    callData: "0x",
    callGasLimit: "0x5f5e1",
    verificationGasLimit: "0x186a0",
    preVerificationGas: numberToHex(gas),
    maxFeePerGas: numberToHex(maxFeePerGas),
    maxPriorityFeePerGas: numberToHex(maxFeePerGas),
    paymasterAndData: "0x",
    signature: "0x",
  };
}

function sponsor({
  chainId,
  gas,
  maxFeePerGas = 0n,
  sender = zeroAddress,
  userOperation = operation(sender, maxFeePerGas, gas),
}: {
  chainId: number | string;
  gas?: bigint;
  maxFeePerGas?: bigint;
  sender?: string;
  userOperation?: Record<string, string | undefined>;
}) {
  return app.request(`/?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId, policyId: "anvil", userOperation }),
  });
}

function bundler(estimate?: bigint | null, priorityFee = 0n, callGas = 200_000n) {
  const request = publicClient.request;
  return vi.spyOn(publicClient, "request").mockImplementation(((parameters: Parameters<typeof request>[0], options) => {
    const { method, params } = parameters as {
      method: string;
      params: [{ callGasLimit: Hex; preVerificationGas: Hex }];
    };
    if (method === "rundler_maxPriorityFeePerGas") return Promise.resolve(numberToHex(priorityFee)); // cspell:ignore rundler
    if (method !== "eth_estimateUserOperationGas" || estimate === undefined) return request(parameters, options);
    const [{ callGasLimit, preVerificationGas }] = params;
    return Promise.resolve({
      preVerificationGas: hexToBigInt(preVerificationGas)
        ? preVerificationGas
        : estimate === null
          ? undefined
          : numberToHex(estimate),
      callGasLimit: hexToBigInt(callGasLimit) ? callGasLimit : numberToHex(callGas),
    });
  }) as typeof publicClient.request);
}

async function spySpans() {
  const { startSpan: real } = await vi.importActual<typeof sentry>("@sentry/node");
  const spans = new Map<string, Record<string, unknown>>();
  vi.mocked(startSpan).mockImplementation(((options, callback) =>
    real(options, (span) => {
      const attributes: Record<string, unknown> = { ...options.attributes };
      spans.set(options.name, attributes);
      const setAttribute = span.setAttribute.bind(span);
      const setAttributes = span.setAttributes.bind(span);
      span.setAttribute = (key, value) => {
        attributes[key] = value;
        return setAttribute(key, value);
      };
      span.setAttributes = (values) => {
        Object.assign(attributes, values);
        return setAttributes(values);
      };
      return callback(span);
    })) as typeof startSpan);
  return spans;
}
