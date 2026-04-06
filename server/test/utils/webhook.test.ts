import { resolve4, resolve6 } from "node:dns/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

import isValid from "../../utils/webhook";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn<() => Promise<string[]>>(),
  resolve6: vi.fn<() => Promise<string[]>>(),
}));

describe("validateWebhookUrl", () => {
  beforeEach(() => {
    vi.mocked(resolve4).mockResolvedValue(["93.184.216.34"]);
    vi.mocked(resolve6).mockResolvedValue([]);
  });

  it("accepts valid https url with public ip", async () => {
    await expect(isValid("https://example.com/webhook")).resolves.toBeUndefined();
  });

  it("rejects http scheme", async () => {
    await expect(isValid("http://example.com")).rejects.toThrow("url must use https");
  });

  it("rejects ftp scheme", async () => {
    await expect(isValid("ftp://example.com/file")).rejects.toThrow("url must use https");
  });

  it("rejects malformed url", async () => {
    await expect(isValid("not-a-url")).rejects.toThrow();
  });

  it("rejects when dns does not resolve", async () => {
    vi.mocked(resolve4).mockRejectedValue(new Error("ENOTFOUND"));
    vi.mocked(resolve6).mockRejectedValue(new Error("ENOTFOUND"));
    await expect(isValid("https://nonexistent.invalid")).rejects.toThrow("url does not resolve");
  });

  it("rejects 127.0.0.0/8", async () => {
    vi.mocked(resolve4).mockResolvedValue(["127.0.0.1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects 10.0.0.0/8", async () => {
    vi.mocked(resolve4).mockResolvedValue(["10.0.0.1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects 172.16.0.0/12", async () => {
    vi.mocked(resolve4).mockResolvedValue(["172.16.0.1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("accepts 172.15.255.255", async () => {
    vi.mocked(resolve4).mockResolvedValue(["172.15.255.255"]);
    await expect(isValid("https://example.com")).resolves.toBeUndefined();
  });

  it("accepts 172.32.0.0", async () => {
    vi.mocked(resolve4).mockResolvedValue(["172.32.0.0"]);
    await expect(isValid("https://example.com")).resolves.toBeUndefined();
  });

  it("rejects 192.168.0.0/16", async () => {
    vi.mocked(resolve4).mockResolvedValue(["192.168.1.1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects 169.254.0.0/16", async () => {
    vi.mocked(resolve4).mockResolvedValue(["169.254.169.254"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects 0.0.0.0", async () => {
    vi.mocked(resolve4).mockResolvedValue(["0.0.0.0"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects ::1", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["::1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects fc00::/7", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["fd12::1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects fe80::/10", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["fe80::1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects fe90::1 (fe80::/10)", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["fe90::1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects fea0::1 (fe80::/10)", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["fea0::1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects feb0::1 (fe80::/10)", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["feb0::1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects fec0::1 (deprecated site-local fec0::/10)", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["fec0::1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects ::ffff-mapped private ipv4", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["::ffff:10.0.0.1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects when any address is private", async () => {
    vi.mocked(resolve4).mockResolvedValue(["93.184.216.34", "10.0.0.1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("rejects 2001:db8::1 (documentation-only rfc 3849)", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["2001:db8::1"]);
    await expect(isValid("https://example.com")).rejects.toThrow("url resolves to private address");
  });

  it("accepts public ipv6", async () => {
    vi.mocked(resolve4).mockResolvedValue([]);
    vi.mocked(resolve6).mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);
    await expect(isValid("https://example.com")).resolves.toBeUndefined();
  });

  it("resolves when only ipv6 succeeds", async () => {
    vi.mocked(resolve4).mockRejectedValue(new Error("ENOTFOUND"));
    vi.mocked(resolve6).mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);
    await expect(isValid("https://example.com")).resolves.toBeUndefined();
  });

  it("resolves when only ipv4 succeeds", async () => {
    vi.mocked(resolve4).mockResolvedValue(["93.184.216.34"]);
    vi.mocked(resolve6).mockRejectedValue(new Error("ENOTFOUND"));
    await expect(isValid("https://example.com")).resolves.toBeUndefined();
  });
});
