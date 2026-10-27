import "../mocks/sentry";

import { captureException, setContext, setExtra, setUser, startSpan } from "@sentry/node";
import { createHmac } from "node:crypto";
import { hexToBigInt, hexToBytes, numberToHex, padHex, zeroAddress, zeroHash } from "viem";
import { entryPoint06Address, entryPoint07Address } from "viem/account-abstraction";
import { privateKeyToAddress } from "viem/accounts";
import { anvil, gnosis, moonbeamDev } from "viem/chains";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import database, { credentials } from "../../database";
import createSponsorHook from "../../hooks/sponsor";
import publicClient from "../../utils/publicClient";

import type * as sentry from "@sentry/node";

const signingKey = "whsec_sponsor"; // cspell:ignore whsec
const { app } = createSponsorHook({ database, signingKey });

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
    const request = bundler(gasPrice);
    const response = await sponsor({ chainId: anvil.id, sender: account.toLowerCase(), maxFeePerGas: gasPrice });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: true });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_estimateUserOperationGas" }));
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
        "sponsor.gas": 560_625,
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
    });
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "sponsor", op: "sponsor.check" }),
      expect.any(Function),
    );
    expect(startSpan).toHaveBeenCalledWith({ name: "find sender", op: "sponsor.sender" }, expect.any(Function));
    expect(startSpan).toHaveBeenCalledWith({ name: "eth_gasPrice", op: "sponsor.gasPrice" }, expect.any(Function));
    expect(startSpan).toHaveBeenCalledWith({ name: "priority fee", op: "sponsor.priorityFee" }, expect.any(Function));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("approves the owner wallet of an exa account on entrypoint v0.7", async () => {
    const gasPrice = await publicClient.getGasPrice();
    bundler(gasPrice);
    const { initCode, paymasterAndData, signature, ...userOperation } = operation(wallet, gasPrice, 280_000n);
    const response = await sponsor({
      chainId: numberToHex(anvil.id),
      userOperation: { ...userOperation, entryPointVersionNumber: "V0_7" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: true });
    expect(initCode).toBe("0x");
    expect(paymasterAndData).toBe("0x");
    expect(signature).toBe("0x");
    expect(spans.get("sponsor")).toStrictEqual({
      "sponsor.chain": anvil.id,
      "sponsor.sender": wallet,
      "sponsor.entrypoint": entryPoint07Address,
      "sponsor.callGasLimit": 390_625,
      "sponsor.gas": 770_625,
      "sponsor.maxFeePerGas": Number(gasPrice),
      "sponsor.maxPriorityFeePerGas": Number(gasPrice),
      "sponsor.paymasterPostOpGasLimit": 0,
      "sponsor.preVerificationGas": 280_000,
      "sponsor.signature.size": 0,
      "sponsor.approved": true,
    });
    expect(spans.has("eth_estimateUserOperationGas")).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["v0.6", "0x"],
    ["v0.7", undefined],
  ])("approves a stub request without a signature on entrypoint %s without estimating it", async (_, initCode) => {
    const request = bundler();
    const response = await sponsor({
      chainId: String(anvil.id),
      userOperation: {
        ...operation(account, 0n, 0n),
        initCode,
        callGasLimit: "0x0",
        verificationGasLimit: undefined,
        signature: undefined,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: true });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_estimateUserOperationGas" }));
    expect(spans.has("eth_estimateUserOperationGas")).toBe(false);
    expect(spans.get("sponsor")).toMatchObject({
      "sponsor.gas": 0,
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

  it("denies a fee far above the network", async () => {
    bundler();
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
    bundler(maxPriorityFeePerGas);
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
    bundler(priorityFee / 2n);
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
    const { promise: asking, resolve } = Promise.withResolvers<unknown>();
    const request = publicClient.request;
    vi.spyOn(publicClient, "request").mockImplementation(((parameters: Parameters<typeof request>[0], options) => {
      if ((parameters as { method: string }).method !== "rundler_maxPriorityFeePerGas") {
        return request(parameters, options);
      }
      resolve(parameters);
      return new Promise(() => undefined);
    }) as typeof publicClient.request);
    const pending = sponsor({ chainId: anvil.id, sender: account, maxFeePerGas: 1n });
    await asking;
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

  it("approves an operation at the absolute gas ceiling", async () => {
    const gasPrice = await publicClient.getGasPrice();
    bundler(gasPrice);
    const response = await sponsor({ chainId: anvil.id, userOperation: heavy(wallet, gasPrice, 19_000_000n) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: true });
    expect(spans.get("sponsor")).toMatchObject({ "sponsor.gas": 20_000_000, "sponsor.approved": true });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("denies an operation above the absolute gas ceiling before any lookup", async () => {
    const findFirst = vi.spyOn(database.query.credentials, "findFirst");
    const request = vi.spyOn(publicClient, "request");
    const response = await sponsor({ chainId: anvil.id, userOperation: heavy(wallet, 1n, 19_000_001n) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("sponsor")).toMatchObject({
      "sponsor.gas": 20_000_001,
      "sponsor.approved": false,
      "sponsor.reason": "excessive gas",
    });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("excessive gas"), {
      level: "warning",
      extra: { chainId: anvil.id, sender: wallet, gas: "20000001" },
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
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

  it("denies a known chain without smart accounts before any lookup", async () => {
    const findFirst = vi.spyOn(database.query.credentials, "findFirst");
    const request = vi.spyOn(publicClient, "request");
    const response = await sponsor({ chainId: gnosis.id, sender: account, maxFeePerGas: 0n });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ approved: false });
    expect(spans.get("sponsor")).toMatchObject({ "sponsor.approved": false, "sponsor.reason": "unsupported chain" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("unsupported chain"), {
      level: "warning",
      extra: { chainId: gnosis.id, sender: account },
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails when another chain can't be reached", async () => {
    const response = await sponsor({ chainId: moonbeamDev.id, sender: account, maxFeePerGas: 1n });

    expect(response.status).toBe(500);
    expect(spans.get("sponsor")).not.toHaveProperty("sponsor.approved");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("refuses to start without a signing key", () => {
    expect(() => createSponsorHook({ database, signingKey: "" })).toThrow("missing sponsor signing key");
  });

  it.each([
    ["without a signature", "/", () => undefined],
    ["with the signing key in the query", `/?token=${signingKey}`, () => undefined],
    ["signed with another key", "/", (body: string) => sign(body, "whsec_other")],
    ["signed over another body", "/", (body: string) => sign(`${body} `)],
    ["with an uppercase signature", "/", (body: string) => sign(body).toUpperCase()],
    ["with a longer signature", "/", (body: string) => `${sign(body)}0`],
  ])("denies a request %s before any work", async (_, path, signature) => {
    const body = JSON.stringify({ chainId: anvil.id, policyId: "anvil", userOperation: operation(account, 1n) });
    const header = signature(body);
    const response = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(header && { "x-alchemy-signature": header }) },
      body,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "invalid signature" });
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

function heavy(sender: string, maxFeePerGas: bigint, callGasLimit: bigint) {
  const { initCode, paymasterAndData, ...userOperation } = operation(sender, maxFeePerGas, 400_000n);
  return {
    ...userOperation,
    callGasLimit: numberToHex(callGasLimit),
    verificationGasLimit: numberToHex(500_000n),
    paymasterVerificationGasLimit: numberToHex(50_000n),
    paymasterPostOpGasLimit: numberToHex(50_000n),
  };
}

function sponsor({
  chainId,
  maxFeePerGas = 0n,
  sender = zeroAddress,
  userOperation = operation(sender, maxFeePerGas),
}: {
  chainId: number | string;
  maxFeePerGas?: bigint;
  sender?: string;
  userOperation?: Record<string, string | undefined>;
}) {
  const body = JSON.stringify({ chainId, policyId: "anvil", userOperation });
  return app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-alchemy-signature": sign(body) },
    body,
  });
}

function sign(body: string, key = signingKey) {
  return createHmac("sha256", key).update(body).digest("hex");
}

function bundler(priorityFee = 0n) {
  const request = publicClient.request;
  return vi.spyOn(publicClient, "request").mockImplementation(((parameters: Parameters<typeof request>[0], options) => {
    if ((parameters as { method: string }).method === "rundler_maxPriorityFeePerGas") {
      return Promise.resolve(numberToHex(priorityFee)); // cspell:ignore rundler
    }
    return request(parameters, options);
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
