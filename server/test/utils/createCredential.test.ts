import "../mocks/sardine";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import database, { credentials } from "../../database";
import createCredentialFactory from "../../utils/createCredential";
import createSardine from "../../utils/sardine";

import type createSubscribe from "../../workers/subscribe/queue";

vi.mock("hono/cookie", () => ({ setSignedCookie: vi.fn() }));

const credentialId = "0x1234567890123456789012345678901234567888";
const enqueue = vi.fn<ReturnType<typeof createSubscribe>["enqueue"]>().mockResolvedValue();
const segment = { close: vi.fn<() => Promise<void>>().mockResolvedValue(), identify: vi.fn(), track: vi.fn() };

afterAll(async () => {
  await database.delete(credentials).where(eq(credentials.id, credentialId));
});

describe("createCredential", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await database.delete(credentials).where(eq(credentials.id, credentialId));
  });

  it("creates a credential and enqueues account subscription", async () => {
    const pending = Symbol("pending");
    const deferred = Promise.withResolvers<undefined>();
    enqueue.mockReturnValueOnce(deferred.promise);
    const response = request();

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

  it("keeps the credential when account subscription fails", async () => {
    enqueue.mockRejectedValueOnce(new Error("subscription failed"));

    const response = await request();

    expect(response.status).toBe(200);
    const row = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true },
    });
    if (!row) throw new Error("missing credential");
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(row.account);
    expect(segment.identify).toHaveBeenCalledExactlyOnceWith({ userId: row.account });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});

function request() {
  return new Hono()
    .post("/", async (c) => {
      await createCredentialFactory({
        authSecret: "secret",
        database,
        sardine: createSardine("sardine", "https://api.sardine.ai"),
        segment,
        subscribe: { close: vi.fn<() => Promise<void>>().mockResolvedValue(), enqueue },
      })(c, credentialId);
      return c.body(null);
    })
    .request("/", { method: "POST" });
}
