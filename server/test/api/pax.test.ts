import "../mocks/auth";
import "../mocks/database";
import "../mocks/deployments";
import "../mocks/sentry";

import deriveAddress from "@exactly/common/deriveAddress";
import { testClient } from "hono/testing";
import { padHex, zeroAddress, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app, { type AppType } from "../../api/pax";
import database, { credentials } from "../../database";
import deriveAssociateId from "../../utils/deriveAssociateId";

const appClient = testClient<AppType>(app);

describe("/pax GET", () => {
  const bob = privateKeyToAddress(padHex("0xb0b"));
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
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
