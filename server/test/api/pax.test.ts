import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import deriveAddress from "@exactly/common/deriveAddress";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { padHex, zeroAddress, zeroHash } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app from "../../api/pax";
import database, { cards, credentials } from "../../database";
import deriveAssociateId from "../../utils/deriveAssociateId";

const appClient = testClient(app);

describe("/pax GET", () => {
  const bob = privateKeyToAddress(generatePrivateKey());
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
    await database.delete(cards).where(eq(cards.credentialId, account));
    await database.delete(credentials).where(eq(credentials.account, account));
    await database.insert(credentials).values([
      {
        id: account,
        publicKey: new Uint8Array(),
        account,
        factory: zeroAddress,
        pandaId: "pandaId",
      },
    ]);
  });

  afterAll(async () => {
    await database.delete(credentials).where(eq(credentials.account, account));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns associate id", async () => {
    const response = await appClient.index.$get(
      {},
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    const expectedId = deriveAssociateId(account);

    await expect(response.json()).resolves.toStrictEqual({ associateId: expectedId });

    expect(response.status).toBe(200);
  });

  it("returns 404 if credential not found", async () => {
    const response = await appClient.index.$get(
      {},
      { headers: { "test-credential-id": "non-existent", SessionID: "fakeSession" } },
    );

    expect(response.status).toBe(404);
  });
});
