import "../mocks/sentry";

import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { resolve4, resolve6 } from "node:dns/promises";
import { mnemonicToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";

import app from "../../api/webhook";
import database, { sources } from "../../database";
import auth from "../../utils/auth";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn<() => Promise<string[]>>(),
  resolve6: vi.fn<() => Promise<string[]>>(),
}));

const appClient = testClient(app);

const owner = mnemonicToAccount("test test test test test test test test test test test junk");
const integratorAccount = mnemonicToAccount("test test test test test test test test test test test integrator");
const memberAccount = mnemonicToAccount("test test test test test test test test test test test member");

describe("webhook", () => {
  const integratorHeaders = new Headers();
  const memberHeaders = new Headers();

  beforeAll(async () => {
    const adminNonceResult = await auth.api.getSiweNonce({
      body: { walletAddress: owner.address, chainId: chain.id },
    });

    const statement = "I accept Exa terms and conditions";
    const ownerMessage = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce: adminNonceResult.nonce,
      uri: `https://${domain}`,
      address: owner.address,
      chainId: chain.id,
      scheme: "https",
      version: "1",
      domain,
    });

    const adminResponse = await auth.api.verifySiweMessage({
      body: {
        message: ownerMessage,
        signature: await owner.signMessage({ message: ownerMessage }),
        walletAddress: owner.address,
        chainId: chain.id,
      },
      request: new Request(`https://${domain}`),
      asResponse: true,
    });
    const ownerHeaders = new Headers();
    ownerHeaders.set("cookie", `${adminResponse.headers.get("set-cookie")}`);

    const integratorNonceResult = await auth.api.getSiweNonce({
      body: { walletAddress: integratorAccount.address, chainId: chain.id },
    });
    const integratorMessage = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce: integratorNonceResult.nonce,
      uri: `https://${domain}`,
      address: integratorAccount.address,
      chainId: chain.id,
      scheme: "https",
      version: "1",
      domain,
    });
    const integratorResponse = await auth.api.verifySiweMessage({
      body: {
        message: integratorMessage,
        signature: await integratorAccount.signMessage({ message: integratorMessage }),
        walletAddress: integratorAccount.address,
        chainId: chain.id,
        email: "integrator@external.com",
      },
      request: new Request(`https://${domain}`),
      asResponse: true,
    });
    integratorHeaders.set("cookie", `${integratorResponse.headers.get("set-cookie")}`);
    const integrator = await auth.api.getSession({ headers: integratorHeaders });
    if (!integrator) throw new Error("integrator not found");

    const memberNonceResult = await auth.api.getSiweNonce({
      body: { walletAddress: memberAccount.address, chainId: chain.id },
    });
    const memberMessage = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce: memberNonceResult.nonce,
      uri: `https://${domain}`,
      address: memberAccount.address,
      chainId: chain.id,
      scheme: "https",
      version: "1",
      domain,
    });
    const memberResponse = await auth.api.verifySiweMessage({
      body: {
        message: memberMessage,
        signature: await memberAccount.signMessage({ message: memberMessage }),
        walletAddress: memberAccount.address,
        chainId: chain.id,
        email: "member@external.com",
      },
      request: new Request(`https://${domain}`),
      asResponse: true,
    });
    memberHeaders.set("cookie", `${memberResponse.headers.get("set-cookie")}`);
    const member = await auth.api.getSession({ headers: memberHeaders });
    if (!member) throw new Error("member not found");

    const externalOrganization = await auth.api.createOrganization({
      headers: ownerHeaders,
      body: { name: "External Organization", slug: "external-organization" },
    });

    const integratorInvitation = await auth.api.createInvitation({
      headers: ownerHeaders,
      body: { email: integrator.user.email, role: "admin", organizationId: externalOrganization.id },
    });
    await auth.api.acceptInvitation({ headers: integratorHeaders, body: { invitationId: integratorInvitation.id } });

    const memberInvitation = await auth.api.createInvitation({
      headers: ownerHeaders,
      body: { email: member.user.email, role: "member", organizationId: externalOrganization.id },
    });
    await auth.api.acceptInvitation({ headers: memberHeaders, body: { invitationId: memberInvitation.id } });
  });

  describe("as integrator", () => {
    let cookie = "";
    let id = "";

    beforeEach(async () => {
      vi.mocked(resolve4).mockResolvedValue(["93.184.216.34"]);
      vi.mocked(resolve6).mockResolvedValue([]);
      cookie = integratorHeaders.get("cookie") ?? "";
      const organizations = await auth.api.listOrganizations({ headers: integratorHeaders });
      id = organizations[0]?.id ?? "";
    });

    afterEach(async () => {
      await database.delete(sources).where(eq(sources.id, id));
    });

    async function seedWebhook(name = "test", url = "https://test.com") {
      const response = await appClient[":name?"].$post(
        { param: { name: undefined }, json: { name, url } },
        { headers: { cookie } },
      );
      expect(response.status).toBe(201);
    }

    async function postWithUrl(targetUrl = "https://test.com") {
      return appClient[":name?"].$post(
        { param: { name: undefined }, json: { name: "test", url: targetUrl } },
        { headers: { cookie } },
      );
    }

    describe("create", () => {
      it("creates a webhook with the name in the body", async () => {
        const response = await appClient[":name?"].$post(
          { param: { name: undefined }, json: { name: "test", url: "https://test.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toStrictEqual({
          name: "test",
          url: "https://test.com",
          secret: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        });

        const source = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        expect(source?.config).toStrictEqual({
          type: "integrator",
          webhooks: { test: { url: "https://test.com", secret: expect.any(String) } }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        });
      });

      it("creates a webhook with the name in the path", async () => {
        const response = await appClient[":name?"].$post(
          { param: { name: "test" }, json: { url: "https://test.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toStrictEqual({
          name: "test",
          url: "https://test.com",
          secret: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        });

        const source = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        expect(source?.config).toStrictEqual({
          type: "integrator",
          webhooks: { test: { url: "https://test.com", secret: expect.any(String) } }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        });
      });

      it("prefers the name in the path over the body", async () => {
        const response = await appClient[":name?"].$post(
          { param: { name: "path" }, json: { name: "body", url: "https://test.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toStrictEqual({
          name: "path",
          url: "https://test.com",
          secret: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        });

        const source = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        expect(source?.config).toStrictEqual({
          type: "integrator",
          webhooks: { path: { url: "https://test.com", secret: expect.any(String) } }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        });
      });

      it("allows multiple webhooks per integrator", async () => {
        await seedWebhook();
        const second = await appClient[":name?"].$post(
          {
            param: { name: undefined },
            json: {
              name: "another",
              url: "https://another.com",
              transaction: { created: "https://another.com/created" },
            },
          },
          { headers: { cookie } },
        );
        expect(second.status).toBe(201);

        const source = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        expect(source?.config).toStrictEqual({
          type: "integrator",
          webhooks: {
            test: { url: "https://test.com", secret: expect.any(String) }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            another: {
              url: "https://another.com",
              secret: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
              transaction: { created: "https://another.com/created" },
            },
          },
        });
      });

      it("rejects a request without a name", async () => {
        const response = await appClient[":name?"].$post(
          { param: { name: undefined }, json: { url: "https://test.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "invalid name" });
      });

      it("rejects an invalid name", async () => {
        const response = await appClient[":name?"].$post(
          { param: { name: "INVALID" }, json: { url: "https://test.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid name",
          legacy: "invalid name",
          message: ["name invalid name"],
        });
      });

      it("rejects a name that is already taken", async () => {
        await seedWebhook();
        const response = await appClient[":name?"].$post(
          { param: { name: undefined }, json: { name: "test", url: "https://second.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toStrictEqual({ code: "name conflict" });
      });

      it("rejects an event url that resolves to a private address", async () => {
        vi.mocked(resolve4).mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["169.254.169.254"]);
        const response = await appClient[":name?"].$post(
          {
            param: { name: undefined },
            json: { name: "test", url: "https://test.com", transaction: { created: "https://evil.internal" } },
          },
          { headers: { cookie } },
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
      });
    });

    describe("list", () => {
      it("returns the configured webhooks", async () => {
        await seedWebhook();
        const response = await appClient[":name?"].$get({ param: { name: undefined } }, { headers: { cookie } });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ test: { url: "https://test.com" } });
      });

      it("returns an empty list when none exist", async () => {
        const response = await appClient[":name?"].$get({ param: { name: undefined } }, { headers: { cookie } });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({});
      });
    });

    describe("get", () => {
      it("returns the webhook", async () => {
        await seedWebhook();
        const response = await appClient[":name?"].$get({ param: { name: "test" } }, { headers: { cookie } });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ url: "https://test.com" });
      });

      it("fails when the name does not exist", async () => {
        await seedWebhook();
        const response = await appClient[":name?"].$get({ param: { name: "missing" } }, { headers: { cookie } });
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ code: "not found" });
      });

      it("fails when no webhooks exist", async () => {
        const response = await appClient[":name?"].$get({ param: { name: "missing" } }, { headers: { cookie } });
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ code: "not found" });
      });

      it("rejects an invalid name", async () => {
        const response = await appClient[":name?"].$get({ param: { name: "BadName" } }, { headers: { cookie } });
        expect(response.status).toBe(400);
      });
    });

    describe("update", () => {
      it("changes the url", async () => {
        await seedWebhook();
        const response = await appClient[":name"].$patch(
          {
            param: { name: "test" },
            json: { url: "https://test.updated.com", transaction: { created: "https://test.updated.com/created" } },
          },
          { headers: { cookie } },
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          name: "test",
          url: "https://test.updated.com",
          transaction: { created: "https://test.updated.com/created" },
        });
      });

      it("preserves the signing secret", async () => {
        await seedWebhook();
        const before = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        const originalSecret = (before?.config as { webhooks: { test: { secret: string } } }).webhooks.test.secret;

        await appClient[":name"].$patch(
          { param: { name: "test" }, json: { url: "https://test.updated.com" } },
          { headers: { cookie } },
        );
        const after = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        expect((after?.config as { webhooks: { test: { secret: string } } }).webhooks.test.secret).toBe(originalSecret);
      });

      it("keeps the stored url when omitted", async () => {
        await seedWebhook();
        const response = await appClient[":name"].$patch(
          { param: { name: "test" }, json: { transaction: { completed: "https://test.com/completed" } } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          name: "test",
          url: "https://test.com",
          transaction: { completed: "https://test.com/completed" },
        });
      });

      it("merges event handlers", async () => {
        await appClient[":name?"].$post(
          {
            param: { name: undefined },
            json: {
              name: "test",
              url: "https://test.com",
              transaction: { created: "https://test.com/created", updated: "https://test.com/updated" },
              card: { updated: "https://test.com/card" },
            },
          },
          { headers: { cookie } },
        );

        const response = await appClient[":name"].$patch(
          {
            param: { name: "test" },
            json: {
              transaction: { completed: "https://test.com/completed" },
              user: { updated: "https://test.com/user" },
            },
          },
          { headers: { cookie } },
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          name: "test",
          url: "https://test.com",
          transaction: {
            created: "https://test.com/created",
            updated: "https://test.com/updated",
            completed: "https://test.com/completed",
          },
          card: { updated: "https://test.com/card" },
          user: { updated: "https://test.com/user" },
        });
      });

      it("clears an event handler when set to null", async () => {
        await appClient[":name?"].$post(
          {
            param: { name: undefined },
            json: {
              name: "test",
              url: "https://test.com",
              transaction: { created: "https://test.com/created", updated: "https://test.com/updated" },
            },
          },
          { headers: { cookie } },
        );

        const response = await appClient[":name"].$patch(
          { param: { name: "test" }, json: { transaction: { created: null } } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          name: "test",
          url: "https://test.com",
          transaction: { updated: "https://test.com/updated" },
        });
      });

      it("removes empty event groups", async () => {
        await appClient[":name?"].$post(
          {
            param: { name: undefined },
            json: {
              name: "test",
              url: "https://test.com",
              transaction: { created: "https://test.com/created" },
              card: { updated: "https://test.com/card" },
              user: { updated: "https://test.com/user" },
            },
          },
          { headers: { cookie } },
        );

        const response = await appClient[":name"].$patch(
          {
            param: { name: "test" },
            json: {
              transaction: { created: null },
              card: { updated: null },
              user: { updated: null },
            },
          },
          { headers: { cookie } },
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ name: "test", url: "https://test.com" });
      });

      it("fails when the name does not exist", async () => {
        await seedWebhook();
        const response = await appClient[":name"].$patch(
          { param: { name: "missing" }, json: { url: "https://test.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ code: "not found" });
      });

      it("fails when no webhooks exist", async () => {
        const response = await appClient[":name"].$patch(
          { param: { name: "test" }, json: { url: "https://test.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ code: "not found" });
      });

      it("rejects an invalid name", async () => {
        const response = await appClient[":name"].$patch(
          { param: { name: "BadName" }, json: { url: "https://test.com" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(400);
      });

      it("rejects a url that resolves to a private address", async () => {
        await seedWebhook();
        vi.mocked(resolve4).mockResolvedValueOnce(["10.0.0.1"]);
        const response = await appClient[":name"].$patch(
          { param: { name: "test" }, json: { url: "https://evil.internal" } },
          { headers: { cookie } },
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
      });
    });

    describe("delete", () => {
      it("removes the integrator when the last webhook is deleted", async () => {
        await seedWebhook();
        const response = await appClient[":name"].$delete({ param: { name: "test" } }, { headers: { cookie } });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });

        const source = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        expect(source).toBeUndefined();
      });

      it("keeps the integrator when other webhooks remain", async () => {
        await seedWebhook();
        await seedWebhook("another", "https://another.com");

        const response = await appClient[":name"].$delete({ param: { name: "test" } }, { headers: { cookie } });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });

        const source = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        expect(source?.config).toStrictEqual({
          type: "integrator",
          webhooks: {
            another: { url: "https://another.com", secret: expect.any(String) }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          },
        });
      });

      it("fails when the name does not exist", async () => {
        await seedWebhook();
        const response = await appClient[":name"].$delete({ param: { name: "missing" } }, { headers: { cookie } });
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ code: "not found" });
      });

      it("fails when no webhooks exist", async () => {
        const response = await appClient[":name"].$delete({ param: { name: "test" } }, { headers: { cookie } });
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ code: "not found" });
      });

      it("rejects an invalid name", async () => {
        const response = await appClient[":name"].$delete({ param: { name: "BadName" } }, { headers: { cookie } });
        expect(response.status).toBe(400);
      });
    });

    describe("url validation", () => {
      describe("scheme", () => {
        it("rejects http", async () => {
          const response = await postWithUrl("http://test.com");
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects ftp", async () => {
          const response = await postWithUrl("ftp://test.com/file");
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });
      });

      describe("dns", () => {
        it("fails when the host does not resolve", async () => {
          vi.mocked(resolve4).mockRejectedValue(new Error("ENOTFOUND"));
          vi.mocked(resolve6).mockRejectedValue(new Error("ENOTFOUND"));
          const response = await postWithUrl("https://nonexistent.invalid");
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("accepts when only ipv6 resolves", async () => {
          vi.mocked(resolve4).mockRejectedValue(new Error("ENOTFOUND"));
          vi.mocked(resolve6).mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);
          const response = await postWithUrl();
          expect(response.status).toBe(201);
        });
      });

      describe("ipv4", () => {
        it("rejects loopback", async () => {
          vi.mocked(resolve4).mockResolvedValue(["127.0.0.1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects private class a", async () => {
          vi.mocked(resolve4).mockResolvedValue(["10.0.0.1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects private class b", async () => {
          vi.mocked(resolve4).mockResolvedValue(["172.16.0.1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects private class c", async () => {
          vi.mocked(resolve4).mockResolvedValue(["192.168.1.1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects link-local", async () => {
          vi.mocked(resolve4).mockResolvedValue(["169.254.169.254"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects the unspecified address", async () => {
          vi.mocked(resolve4).mockResolvedValue(["0.0.0.0"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("accepts the address just below private class b", async () => {
          vi.mocked(resolve4).mockResolvedValue(["172.15.255.255"]);
          const response = await postWithUrl();
          expect(response.status).toBe(201);
        });

        it("accepts the address just above private class b", async () => {
          vi.mocked(resolve4).mockResolvedValue(["172.32.0.0"]);
          const response = await postWithUrl();
          expect(response.status).toBe(201);
        });

        it("rejects when one of multiple resolved addresses is private", async () => {
          vi.mocked(resolve4).mockResolvedValue(["93.184.216.34", "10.0.0.1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });
      });

      describe("ipv6", () => {
        beforeEach(() => {
          vi.mocked(resolve4).mockResolvedValue([]);
        });

        it("rejects loopback", async () => {
          vi.mocked(resolve6).mockResolvedValue(["::1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects unique local", async () => {
          vi.mocked(resolve6).mockResolvedValue(["fd12::1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it.each([["fe80::1"], ["fe90::1"], ["fea0::1"], ["feb0::1"]])("rejects link-local %s", async (address) => {
          vi.mocked(resolve6).mockResolvedValue([address]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects deprecated site-local", async () => {
          vi.mocked(resolve6).mockResolvedValue(["fec0::1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects ipv4-mapped private addresses", async () => {
          vi.mocked(resolve6).mockResolvedValue(["::ffff:10.0.0.1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("rejects the documentation range", async () => {
          vi.mocked(resolve6).mockResolvedValue(["2001:db8::1"]);
          const response = await postWithUrl();
          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid url" });
        });

        it("accepts public addresses", async () => {
          vi.mocked(resolve6).mockResolvedValue(["2606:2800:220:1:248:1893:25c8:1946"]);
          const response = await postWithUrl();
          expect(response.status).toBe(201);
        });
      });
    });
  });

  describe("as member", () => {
    let cookie = "";

    beforeEach(() => {
      cookie = memberHeaders.get("cookie") ?? "";
    });

    it("cannot list webhooks", async () => {
      const response = await appClient[":name?"].$get({ param: { name: undefined } }, { headers: { cookie } });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toStrictEqual({ code: "no permission" });
    });

    it("cannot get a webhook", async () => {
      const response = await appClient[":name?"].$get({ param: { name: "test" } }, { headers: { cookie } });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toStrictEqual({ code: "no permission" });
    });

    it("cannot create a webhook", async () => {
      const response = await appClient[":name?"].$post(
        { param: { name: undefined }, json: { name: "test", url: "https://test.com" } },
        { headers: { cookie } },
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toStrictEqual({ code: "no permission" });
    });

    it("cannot update a webhook", async () => {
      const response = await appClient[":name"].$patch(
        { param: { name: "test" }, json: { url: "https://test.com" } },
        { headers: { cookie } },
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toStrictEqual({ code: "no permission" });
    });

    it("cannot delete a webhook", async () => {
      const response = await appClient[":name"].$delete({ param: { name: "test" } }, { headers: { cookie } });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toStrictEqual({ code: "no permission" });
    });
  });
});
