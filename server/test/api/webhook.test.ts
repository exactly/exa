import "../mocks/sentry";
import "../mocks/database";
import chain from "@exactly/common/generated/chain";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { mnemonicToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import app from "../../api/webhook";
import database, { sources } from "../../database";
import auth from "../../utils/auth";

const appClient = testClient(app);

const owner = mnemonicToAccount("test test test test test test test test test test test junk");
const integratorAccount = mnemonicToAccount("test test test test test test test test test test test integrator");

describe("webhook", () => {
  const integratorHeaders = new Headers();

  describe("authenticated", () => {
    beforeAll(async () => {
      const adminNonceResult = await auth.api.getSiweNonce({
        body: { walletAddress: owner.address, chainId: chain.id },
      });

      const statement = "I accept Exa terms and conditions";
      const ownerMessage = createSiweMessage({
        statement,
        resources: ["https://exactly.github.io/exa"],
        nonce: adminNonceResult.nonce,
        uri: `https://localhost`,
        address: owner.address,
        chainId: chain.id,
        scheme: "https",
        version: "1",
        domain: "localhost",
      });

      const adminResponse = await auth.api.verifySiweMessage({
        body: {
          message: ownerMessage,
          signature: await owner.signMessage({ message: ownerMessage }),
          walletAddress: owner.address,
          chainId: chain.id,
        },
        request: new Request("https://localhost"),
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
        uri: `https://localhost`,
        address: integratorAccount.address,
        chainId: chain.id,
        scheme: "https",
        version: "1",
        domain: "localhost",
      });
      const integratorResponse = await auth.api.verifySiweMessage({
        body: {
          message: integratorMessage,
          signature: await integratorAccount.signMessage({ message: integratorMessage }),
          walletAddress: integratorAccount.address,
          chainId: chain.id,
          email: "integrator@external.com",
        },
        request: new Request("https://localhost"),
        asResponse: true,
      });
      integratorHeaders.set("cookie", `${integratorResponse.headers.get("set-cookie")}`);
      const integrator = await auth.api.getSession({ headers: integratorHeaders });

      const externalOrganization = await auth.api.createOrganization({
        headers: ownerHeaders,
        body: {
          name: "External Organization",
          slug: "external-organization",
          keepCurrentActiveOrganization: false,
        },
      });

      const integratorInvitation = await auth.api.createInvitation({
        headers: ownerHeaders,
        body: {
          email: integrator?.user.email ?? "",
          role: "admin",
          organizationId: externalOrganization?.id,
        },
      });
      await auth.api.acceptInvitation({
        headers: integratorHeaders,
        body: {
          invitationId: integratorInvitation.id ?? "",
        },
      });
    });

    afterEach(async () => {
      const organizations = await auth.api.listOrganizations({
        headers: integratorHeaders,
      });
      const id = organizations[0]?.id ?? "";
      await database.delete(sources).where(eq(sources.id, id));
    });

    it("creates and gets a webhook", async () => {
      const organizations = await auth.api.listOrganizations({
        headers: integratorHeaders,
      });
      const id = organizations[0]?.id ?? "";
      const cookie = integratorHeaders.get("cookie") ?? "";

      const response = await appClient.index.$post(
        {
          json: {
            name: "test",
            url: "https://test.com",
          },
        },
        { headers: { cookie } },
      );
      const source = await database.query.sources.findFirst({
        where: eq(sources.id, id),
      });

      const getWebhook = await appClient.index.$get({}, { headers: { cookie } });

      expect(getWebhook.status).toBe(200);
      expect(response.status).toBe(200);

      expect(source?.config).toStrictEqual({
        type: "uphold",
        webhooks: {
          test: {
            url: "https://test.com",
            secret: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          },
        },
      });

      await expect(getWebhook.json()).resolves.toStrictEqual({
        test: {
          url: "https://test.com",
        },
      });
    });

    it("updates a webhook", async () => {
      const organizations = await auth.api.listOrganizations({
        headers: integratorHeaders,
      });
      const id = organizations[0]?.id ?? "";

      const create = await appClient.index.$post(
        {
          json: {
            name: "test",
            url: "https://test.com",
          },
        },
        { headers: { cookie: integratorHeaders.get("cookie") ?? "" } },
      );

      const update = await appClient.index.$post(
        {
          json: {
            name: "test",
            url: "https://test.updated.com",
            transaction: {
              created: "https://test.updated.com/created",
            },
          },
        },
        { headers: { cookie: integratorHeaders.get("cookie") ?? "" } },
      );

      const createAnother = await appClient.index.$post(
        {
          json: {
            name: "another",
            url: "https://another.updated.com",
            transaction: {
              created: "https://another.updated.com/created",
            },
          },
        },
        { headers: { cookie: integratorHeaders.get("cookie") ?? "" } },
      );

      const source = await database.query.sources.findFirst({
        where: eq(sources.id, id),
      });

      expect(source?.config).toStrictEqual({
        type: "uphold",
        webhooks: {
          test: {
            url: "https://test.updated.com",
            secret: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            transaction: {
              created: "https://test.updated.com/created",
            },
          },
          another: {
            url: "https://another.updated.com",
            secret: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            transaction: {
              created: "https://another.updated.com/created",
            },
          },
        },
      });

      expect(create.status).toBe(200);
      expect(update.status).toBe(200);
      expect(createAnother.status).toBe(200);
    });

    it("deletes a webhook", async () => {
      const organizations = await auth.api.listOrganizations({
        headers: integratorHeaders,
      });
      const id = organizations[0]?.id ?? "";
      const create = await appClient.index.$post(
        {
          json: {
            name: "test",
            url: "https://test.com",
          },
        },
        { headers: { cookie: integratorHeaders.get("cookie") ?? "" } },
      );

      const remove = await appClient.index.$delete(
        { json: { name: "test" } },
        { headers: { cookie: integratorHeaders.get("cookie") ?? "" } },
      );
      const source = await database.query.sources.findFirst({
        where: eq(sources.id, id),
      });

      expect(source?.config).toStrictEqual({
        type: "uphold",
        webhooks: {},
      });

      expect(create.status).toBe(200);
      expect(remove.status).toBe(200);
    });
  });
});
