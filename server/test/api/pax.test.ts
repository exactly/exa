import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { testClient } from "hono/testing";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";

import route from "../../api/pax";
import database from "../../database";
import authenticate from "../../middleware/auth";
import createPax, { deriveAssociateId } from "../../utils/pax";

const appClient = testClient(
  route({
    auth: authenticate(""),
    database,
    pax: createPax({
      associateKey: parse(pipe(string(), nonEmpty()), env.PAX_ASSOCIATE_ID_KEY),
      key: parse(pipe(string(), nonEmpty()), env.PAX_API_KEY),
      url: parse(pipe(string(), nonEmpty()), env.PAX_API_URL),
    }),
  }),
);

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
