import "../mocks/sardine";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import database, { credentials } from "../../database";
import createCredentialFactory from "../../utils/createCredential";
import redis from "../../utils/redis";
import createSardine from "../../utils/sardine";
import createSubscribe from "../../workers/subscribe/queue";

vi.mock("hono/cookie", () => ({ setSignedCookie: vi.fn() }));

const credentialId = "0x1234567890123456789012345678901234567888";
const subscribe = createSubscribe(redis);
const segment = { close: vi.fn<() => Promise<void>>().mockResolvedValue(), identify: vi.fn(), track: vi.fn() };

afterAll(async () => {
  await database.delete(credentials).where(eq(credentials.id, credentialId));
  await subscribe.close();
});

describe("createCredential", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await database.delete(credentials).where(eq(credentials.id, credentialId));
  });

  it("creates a credential and enqueues account subscription", async () => {
    const pending = Symbol("pending");
    const deferred = Promise.withResolvers<boolean>();
    const add = Queue.prototype.add; // eslint-disable-line @typescript-eslint/unbound-method -- called with the queue
    const spy = vi.spyOn(Queue.prototype, "add").mockImplementationOnce(async function (this: Queue, ...args) {
      await deferred.promise;
      return add.apply(this, args);
    });
    const response = request();

    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    expect(await Promise.race([response, Promise.resolve(pending)])).toBe(pending);
    deferred.resolve(true);

    const result = await response;
    expect(result.status).toBe(200);
    const row = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, factory: true, id: true, source: true },
    });
    if (!row) throw new Error("missing credential");
    expect(spy).toHaveBeenCalledExactlyOnceWith(
      "subscribe",
      { account: row.account, sentryBaggage: expect.any(String) as string, sentryTrace: expect.any(String) as string },
      { jobId: row.account },
    );
    await expect(spy.mock.results[0]?.value).resolves.toMatchObject({ id: row.account });
    expect(row).toStrictEqual({
      account: row.account,
      factory: exaAccountFactoryAddress,
      id: credentialId,
      source: null,
    });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("keeps the credential when account subscription fails", async () => {
    const add = vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(new Error("subscription failed"));

    const response = await request();

    expect(response.status).toBe(200);
    const row = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true },
    });
    if (!row) throw new Error("missing credential");
    expect(add).toHaveBeenCalledExactlyOnceWith("subscribe", expect.objectContaining({ account: row.account }), {
      jobId: row.account,
    });
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
        subscribe,
      })(c, credentialId);
      return c.body(null);
    })
    .request("/", { method: "POST" });
}
