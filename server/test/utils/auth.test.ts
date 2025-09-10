import "../mocks/sentry";

import { captureException } from "@sentry/core";
import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, describe, expect, it, vi } from "vitest";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";

import betterAuth from "../../utils/auth";
import publicClient from "../../utils/publicClient";

import type { SIWEPluginOptions } from "better-auth/plugins/siwe";

vi.mock("@sentry/core", { spy: true });

const verifySiweMessage = betterAuth.options.plugins.find((plugin) => plugin.id === "siwe")?.options.verifyMessage;
if (!verifySiweMessage) throw new Error("siwe plugin not registered");

const account = privateKeyToAccount(padHex("0xa11ce"));
const nonce = "abcdef0123456789";

async function verifyInput(
  overrides: Partial<Parameters<SIWEPluginOptions["verifyMessage"]>[0]> & {
    messageChainId?: number;
    messageDomain?: string;
    messageNonce?: string;
  } = {},
) {
  const messageChainId = overrides.messageChainId ?? chain.id;
  const messageDomain = overrides.messageDomain ?? domain;
  const messageNonce = overrides.messageNonce ?? nonce;
  const message =
    overrides.message ??
    createSiweMessage({
      address: account.address,
      chainId: messageChainId,
      domain: messageDomain,
      nonce: messageNonce,
      uri: `https://${messageDomain}`,
      version: "1",
    });
  const signature = overrides.signature ?? (await account.signMessage({ message }));
  const cacao =
    "cacao" in overrides
      ? overrides.cacao
      : ({
          h: { t: "caip122" }, // cspell:ignore caip122
          p: { domain, aud: `https://${domain}`, nonce, iss: `did:pkh:eip155:${chain.id}:${account.address}` },
          s: { t: "eip191", s: signature },
        } as const);
  return {
    address: overrides.address ?? account.address,
    chainId: overrides.chainId ?? chain.id,
    message,
    signature,
    cacao,
  };
}

describe("siwe verifyMessage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns false when request chainId does not match project chain", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage");
    const args = await verifyInput({ chainId: chain.id + 1 });

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns false when address is invalid", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage");
    const args = await verifyInput({ address: "not-an-address" });

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns false when signature is not hex", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage");
    const args = await verifyInput({ signature: "not-a-signature" });

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns false when cacao is missing", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage");
    const args = await verifyInput({ cacao: undefined });

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns false when siwe nonce does not match cacao nonce", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage");
    const args = await verifyInput({ messageNonce: "abcdef0123456798" });

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns false when siwe domain does not match project domain", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage");
    const args = await verifyInput({ messageDomain: "evil.example" });

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns false when siwe chainId does not match project chain", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage");
    const args = await verifyInput({ messageChainId: chain.id + 1 });

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns false when public client rejects the signature", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage").mockResolvedValueOnce(false);
    const args = await verifyInput();

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).toHaveBeenCalledWith({
      address: account.address,
      message: args.message,
      signature: args.signature,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns true when public client accepts the signature", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage").mockResolvedValueOnce(true);
    const args = await verifyInput();

    await expect(verifySiweMessage(args)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith({
      address: account.address,
      message: args.message,
      signature: args.signature,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures exception and returns false when verifier throws", async () => {
    const verify = vi.spyOn(publicClient, "verifyMessage").mockRejectedValueOnce(new Error("boom"));
    const args = await verifyInput();

    await expect(verifySiweMessage(args)).resolves.toBe(false);
    expect(verify).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(new Error("boom"), { level: "error" });
  });
});
