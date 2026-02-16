import customer from "../mocks/sardine";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import database, { credentials } from "../../database";
import createCredential from "../../utils/createCredential";
import { enqueue } from "../../workers/subscribe/queue";

const mocks = vi.hoisted(() => ({ domain: "sandbox.exactly.app" }));

vi.mock("@exactly/common/domain", () => ({
  get default() {
    return mocks.domain;
  },
}));
vi.mock("hono/cookie", () => ({ setSignedCookie: vi.fn() }));
vi.mock("../../utils/authSecret", () => ({ default: "secret" }));
vi.mock("../../utils/segment", () => ({ identify: vi.fn() }));
vi.mock("../../workers/subscribe/queue", () => ({ enqueue: vi.fn<() => Promise<void>>().mockResolvedValue() }));

const credentialId = "0x1234567890123456789012345678901234567888";

function credential(source?: string) {
  return new Hono()
    .onError((error) => {
      throw error;
    })
    .post("/", async (c) => {
      await createCredential(c, credentialId, { source });
      return c.body(null);
    })
    .request("/", { method: "POST" });
}

afterAll(async () => {
  await database.delete(credentials).where(eq(credentials.id, credentialId));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCredential", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.domain = "sandbox.exactly.app";
    await database.delete(credentials).where(eq(credentials.id, credentialId));
  });

  it("creates a credential and enqueues account subscription", async () => {
    const pending = Symbol("pending");
    const deferred = Promise.withResolvers<undefined>();
    vi.mocked(enqueue).mockReturnValueOnce(deferred.promise);
    const response = credential();

    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
    expect(await Promise.race([response, Promise.resolve(pending)])).toBe(pending);
    deferred.resolve(undefined); // eslint-disable-line unicorn/no-useless-undefined -- actually required

    const result = await response;
    expect(result.status).toBe(200);
    const row = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, factory: true, id: true, source: true },
    });
    if (!row) throw new Error("missing credential");
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(row.account);
    expect(row).toStrictEqual({
      account: row.account,
      factory: exaAccountFactoryAddress,
      id: credentialId,
      source: null,
    });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures sardine failures after creating the credential", async () => {
    const error = new Error("sardine error");
    vi.mocked(customer).mockRejectedValueOnce(error);

    const response = await credential();

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, { level: "error" }));
  });

  it("sets local cookie options on localhost", async () => {
    mocks.domain = "localhost";

    const response = await credential();

    expect(response.status).toBe(200);
    expect(vi.mocked(setSignedCookie)).toHaveBeenCalledWith(
      expect.anything(),
      "credential_id",
      credentialId,
      "secret",
      { expires: expect.any(Date) as Date, httpOnly: true, sameSite: "lax", secure: false },
    );
  });

  it("rejects bad credentials", async () => {
    await expect(
      new Hono()
        .onError((error) => {
          throw error;
        })
        .post("/", async (c) => {
          await createCredential(c, "bad");
          return c.body(null);
        })
        .request("/", { method: "POST" }),
    ).rejects.toThrow("bad credential");
  });
});
