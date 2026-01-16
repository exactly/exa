import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { testClient } from "hono/testing";
import { padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";

import app from "../../api/pax";
import { deriveAssociateId } from "../../utils/pax";

const appClient = testClient(app);

describe("/pax GET", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns associate id", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "bob" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      associateId: deriveAssociateId(
        deriveAddress(inject("ExaAccountFactory"), { x: padHex(privateKeyToAddress(padHex("0xb0b"))), y: zeroHash }),
      ),
    });
  });

  it("returns 500 if credential not found", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "non-existent" } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({ code: "no credential" });
  });
});
