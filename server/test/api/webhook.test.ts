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
const memberAccount = mnemonicToAccount("test test test test test test test test test test test member");
const integratorAccount = mnemonicToAccount("test test test test test test test test test test test integrator");

describe("webhook", () => {
  const integratorHeaders = new Headers();

  describe("authenticated", () => {
    beforeAll(async () => {
      const adminNonceResult = await auth.api.getSiweNonce({
        body: { walletAddress: owner.address, chainId: chain.id },
      });

      const statement = "I accept Exa terms and conditions";
      const adminMessage = createSiweMessage({
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
          message: adminMessage,
          signature: await owner.signMessage({ message: adminMessage }),
          walletAddress: owner.address,
          chainId: chain.id,
        },
        request: new Request("https://localhost"),
        asResponse: true,
      });
      const adminHeaders = new Headers();
      adminHeaders.set("cookie", `${adminResponse.headers.get("set-cookie")}`);

      const memberNonceResult = await auth.api.getSiweNonce({
        body: { walletAddress: memberAccount.address, chainId: chain.id },
      });
      const memberMessage = createSiweMessage({
        statement,
        resources: ["https://exactly.github.io/exa"],
        nonce: memberNonceResult.nonce,
        uri: `https://localhost`,
        address: memberAccount.address,
        chainId: chain.id,
        scheme: "https",
        version: "1",
        domain: "localhost",
      });

      const memberResponse = await auth.api.verifySiweMessage({
        body: {
          message: memberMessage,
          signature: await memberAccount.signMessage({ message: memberMessage }),
          walletAddress: memberAccount.address,
          email: "member@exactly.com",
          chainId: chain.id,
        },
        request: new Request("https://localhost"),
        asResponse: true,
      });
      const memberHeaders = new Headers();
      memberHeaders.set("cookie", `${memberResponse.headers.get("set-cookie")}`);
      const member = await auth.api.getSession({ headers: memberHeaders });

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

      const exaLabs = await auth.api.createOrganization({
        headers: adminHeaders,
        body: {
          name: "Exa Labs",
          slug: "exa-labs",
          keepCurrentActiveOrganization: false,
        },
      });

      const memberInvitation = await auth.api.createInvitation({
        headers: adminHeaders,
        body: {
          email: member?.user.email ?? "",
          role: "member",
          organizationId: exaLabs?.id,
        },
      });
      await auth.api.acceptInvitation({
        headers: memberHeaders,
        body: {
          invitationId: memberInvitation.id,
        },
      });

      const externalOrganization = await auth.api.createOrganization({
        headers: memberHeaders,
        body: {
          name: "External Organization",
          slug: "external-organization",
          keepCurrentActiveOrganization: false,
        },
      });

      const integratorInvitation = await auth.api.createInvitation({
        headers: memberHeaders,
        body: {
          email: integrator?.user.email ?? "",
          role: "member",
          organizationId: externalOrganization?.id,
        },
      });
      await auth.api.acceptInvitation({
        headers: integratorHeaders,
        body: {
          invitationId: integratorInvitation.id,
        },
      });
    });

    afterEach(async () => {
      await database.delete(sources).where(eq(sources.id, "external-organization"));
    });

    it("creates a webhook", async () => {
      const response = await appClient.index.$post(
        {
          json: {
            name: "test",
            url: "https://test.com",
          },
        },
        { headers: { cookie: integratorHeaders.get("cookie") ?? "" } },
      );
      const source = await database.query.sources.findFirst({
        where: eq(sources.id, "external-organization"),
      });

      expect(source?.config).toStrictEqual({
        type: "uphold",
        webhooks: {
          test: {
            url: "https://test.com",
            secret: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          },
        },
      });

      expect(response.status).toBe(200);
    });

    it("updates a webhook", async () => {
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
        where: eq(sources.id, "external-organization"),
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
        where: eq(sources.id, "external-organization"),
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
