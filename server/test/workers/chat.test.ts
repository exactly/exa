import "../mocks/sentry";

import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { RedisStore } from "@mastra/redis";
import { captureException } from "@sentry/node";
import { Queue, QueueEvents, UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import { parse, string } from "valibot";
import { zeroAddress } from "viem";
import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import database, { credentials } from "../../database";
import appOrigin from "../../utils/appOrigin";
import createWhatsapp from "../../utils/whatsapp";
import { attempts } from "../../workers/chat/job";
import createChat from "../../workers/chat/queue";
import createChatWorker, { chat } from "../../workers/chat/worker";
import { connect } from "../../workers/worker";

import type { Job } from "../../workers/chat/job";
import type { context } from "../../workers/chat/worker";
import type { InferPublicSchema } from "@mastra/core/schema";
import type { JobsOptions } from "bullmq";

const redisUrl = parse(string(), process.env.REDIS_URL);
const bullmq = connect(redisUrl);
const queue = new Queue<Job, void>("chat", { connection: bullmq });
const events = new QueueEvents("chat", { connection: bullmq });
const publisher = createChat(bullmq);
const whatsapp = createWhatsapp({ from: "321", key: "chat", token: "whatsapp" });
const store = new RedisStore({ id: "chat-worker", connectionString: redisUrl });
const { agent, reply } = chat("anthropic", whatsapp, store);
const me = "US.12345678";
const credentialId = "chat-worker";

let worker: ReturnType<typeof createChatWorker>;
let connection: ReturnType<typeof connect>;

afterAll(async () => {
  await Promise.all([publisher.close(), queue.close(), events.close()]);
  await bullmq.quit();
  await database.delete(credentials).where(eq(credentials.id, credentialId));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

beforeAll(async () => {
  await events.waitUntilReady();
});

beforeEach(async () => {
  await queue.drain(true);
  await database.delete(credentials).where(eq(credentials.id, credentialId));
});

describe("chat", () => {
  it("hides the account tools until the number is associated", async () => {
    await expect(agent.listTools({ requestContext: current() }).then(Object.keys)).resolves.toStrictEqual([
      "associate",
      "support",
    ]);
    await expect(
      agent.listTools({ requestContext: current({ credentialId: "credential" }) }).then(Object.keys),
    ).resolves.toStrictEqual(["associate", "verification", "card", "transfers", "support"]);
  });

  it("tells the model the number is not associated", async () => {
    const instructions = await agent.getInstructions({ requestContext: current() });

    expect(instructions).toContain("This number is not associated with any Exa account.");
    expect(instructions).not.toContain("This number is associated with an Exa account.");
  });

  it("tells the model the account behind an associated number", async () => {
    const instructions = await agent.getInstructions({
      requestContext: current({ account: "0x69", credentialId: "credential" }),
    });

    expect(instructions).toContain("This number is associated with an Exa account.");
    expect(instructions).toContain("The account is 0x69.");
    expect(instructions).not.toContain("This number is not associated with any Exa account.");
  });

  it.each(["en", "en-US", "EN", "EN-US"])(
    "composes an english sign-in link for %s without translating",
    async (language) => {
      const translate = vi.spyOn(Agent.prototype, "generate");
      const { guidance, link } = await execute("associate", language);
      const [url, close] = link.split("\n\n");

      expect(guidance).toContain("the link is appended to your reply for you");
      expect(url).toMatch(`${appOrigin}/whatsapp?token=`);
      expect(close).toContain("Sign in and follow the steps.");
      await expect(whatsapp.decode(new URL(url ?? "").searchParams.get("token") ?? "")).resolves.toBe(me);
      expect(translate).not.toHaveBeenCalled();
    },
  );

  it("offers to move the number when it already has an account", async () => {
    const { link } = await execute("associate", "en", { credentialId: "credential" });

    expect(link).toContain("this number moves to whichever you use");
    expect(link).not.toContain("Sign in and follow the steps.");
  });

  it("translates the link copy into the language the person wrote in", async () => {
    const translate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValue({ text: "  Iniciá sesión y seguí los pasos.  " } as never); // cspell:ignore Iniciá sesión seguí pasos
    const { link } = await execute("associate", "es-AR");

    expect(link).toContain("Iniciá sesión y seguí los pasos."); // cspell:ignore Iniciá sesión seguí pasos
    expect(link).not.toContain("Sign in and follow the steps.");
    expect(translate).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Translate to es-AR:") as never);
  });

  it("hands off to the app with an introduction and no token", async () => {
    const associated = { credentialId: "credential" };

    for (const tool of ["verification", "card", "transfers"] as const) {
      await expect(execute(tool, "en", associated).then(({ link }) => link)).resolves.toBe(
        `You can continue this in the app.\n${appOrigin}`,
      );
    }
  });

  it("points at support when there is nothing to introduce", async () => {
    await expect(execute("support").then(({ link }) => link)).resolves.toBe(`${appOrigin}/?support`);
  });

  it("appends the last link to the last thing the model wrote", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate").mockResolvedValue({
      steps: [{ text: "on it" }, { text: "   " }, { text: "  here you go  " }],
      toolResults: [
        { payload: { result: { guidance: "no link" } } },
        { payload: { result: { guidance: "first", link: "https://first.test" } } },
        { payload: { result: { guidance: "last", link: "https://last.test" } } },
      ],
    } as never);
    const options = { memory: { resource: me, thread: `sender/${me}` } };

    await expect(reply("hi", options).then(({ text }) => text)).resolves.toBe("here you go\n\nhttps://last.test");
    expect(generate).toHaveBeenCalledExactlyOnceWith("hi", options);
  });

  it("fails instead of replying with nothing when the model neither wrote nor called a tool", async () => {
    vi.spyOn(Agent.prototype, "generate").mockResolvedValue({ steps: [{ text: " " }], toolResults: [] } as never);

    await expect(reply("hi")).rejects.toThrow("no reply composed");
  });
});

describe("chat queue", () => {
  it("publishes a retryable job", async () => {
    await publisher.enqueue({
      contact: "John",
      from: me,
      id: "whatsapp-queue",
      phoneNumberId: "321",
      text: "Hi!",
    });
    const job = await queue.getJob("whatsapp-queue");
    if (!job) throw new Error("job not found");
    expect(job.name).toBe("chat");
    expect(job.data).toStrictEqual({
      contact: "John",
      from: me,
      phoneNumberId: "321",
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
      text: "Hi!",
    });
    expect(job.opts).toStrictEqual({
      attempts,
      backoff: { type: "exponential", delay: 1000 },
      jobId: "whatsapp-queue",
      removeOnComplete: true,
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    });
    await job.remove();
  });

  it("propagates queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);
    await expect(
      publisher.enqueue({ from: me, id: "whatsapp-failure", phoneNumberId: "321", text: "Hi!" }),
    ).rejects.toThrow(error);
  });
});

describe("chat worker", () => {
  afterAll(async () => {
    await worker.close();
    await store.close();
    await connection.quit();
  });

  beforeAll(async () => {
    connection = connect(redisUrl);
    worker = createChatWorker({ anthropicKey: "anthropic", bullmq: connection, database, store, whatsapp });
    await worker.ready;
  });

  it("replies with an unassociated sender's current situation and persistent thread", async () => {
    const generate = generated("sure!");
    const send = vi.spyOn(whatsapp, "send").mockResolvedValue();

    await jobFinished("whatsapp-new");

    expect(generate).toHaveBeenCalledExactlyOnceWith("Hi!", {
      memory: { resource: me, thread: `321/${me}` },
      requestContext: expect.any(RequestContext) as RequestContext,
    });
    expect(situation(generate).get("credentialId")).toBeUndefined();
    expect(situation(generate).get("whatsappId")).toBe(me);
    expect(send).toHaveBeenCalledExactlyOnceWith(me, "sure!");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("gives the chat the account currently associated with the sender", async () => {
    await database.insert(credentials).values({
      id: credentialId,
      publicKey: new Uint8Array(),
      account: "0x0000000000000000000000000000000000000069",
      bridgeId: "bridge",
      factory: zeroAddress,
      pandaId: "panda",
      whatsappId: me,
    });
    const generate = generated("welcome back!");
    vi.spyOn(whatsapp, "send").mockResolvedValue();

    await jobFinished("whatsapp-associated");

    expect(situation(generate).toJSON()).toStrictEqual({
      account: "0x0000000000000000000000000000000000000069",
      bridgeId: "bridge",
      credentialId,
      pandaId: "panda",
      whatsappId: me,
    });
  });

  it("reports a model failure after the final attempt", async () => {
    vi.spyOn(Agent.prototype, "generate").mockRejectedValue(new Error("model down"));
    const send = vi.spyOn(whatsapp, "send").mockResolvedValue();

    await expect(jobFinished("whatsapp-model-failure")).rejects.toThrow("model down");
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("model down"), {
      extra: { attempts: 1, from: me, id: "whatsapp-model-failure" },
      level: "fatal",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a rejected whatsapp delivery", async () => {
    generated("sure!");
    vi.spyOn(whatsapp, "send").mockRejectedValue(new Error("delivery down"));

    await expect(jobFinished("whatsapp-send-failure")).rejects.toThrow("delivery down");
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("delivery down"), {
      extra: { attempts: 1, from: me, id: "whatsapp-send-failure" },
      level: "fatal",
    });
  });

  it("does not retry an unrecoverable WhatsApp rejection", async () => {
    const error = new UnrecoverableError("invalid recipient");
    const generate = generated("sure!");
    const send = vi.spyOn(whatsapp, "send").mockRejectedValue(error);
    await expect(jobFinished("whatsapp-permanent-failure", { attempts })).rejects.toThrow("invalid recipient");
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    expect(generate).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { attempts: 1, from: "US.12345678", id: "whatsapp-permanent-failure" },
      level: "fatal",
    });
  });

  it("captures store errors instead of crashing", () => {
    const listener = store.getClient().listeners("error").at(-1);
    assert(listener);
    listener(new Error("socket closed"));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("socket closed"));
  });

  it("captures bullmq errors instead of crashing", async () => {
    const dedicated = connect(redisUrl);
    const existing = dedicated.listeners("error");
    const dedicatedStore = new RedisStore({ id: "chat-worker-errors", connectionString: redisUrl });
    const observed = createChatWorker({
      anthropicKey: "anthropic",
      bullmq: dedicated,
      database,
      store: dedicatedStore,
      whatsapp,
    });
    const listener = dedicated.listeners("error").find((candidate) => !existing.includes(candidate));
    assert(listener);
    listener(new Error("socket closed"));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("socket closed"));
    await observed.ready;
    await observed.close();
    await dedicatedStore.close();
    await dedicated.quit();
  });

  it("closes in idempotent way", async () => {
    const dedicated = connect(redisUrl);
    const dedicatedStore = new RedisStore({ id: "chat-worker-close", connectionString: redisUrl });
    const observed = createChatWorker({
      anthropicKey: "anthropic",
      bullmq: dedicated,
      database,
      store: dedicatedStore,
      whatsapp,
    });
    await observed.ready;
    await expect(Promise.all([observed.close(), observed.close()])).resolves.toStrictEqual([undefined, undefined]);
    await dedicatedStore.close();
    await dedicated.quit();
  });
});

function generated(text: string) {
  return vi.spyOn(Agent.prototype, "generate").mockResolvedValue({ steps: [{ text }], toolResults: [] } as never);
}

async function execute(
  tool: "associate" | "card" | "support" | "transfers" | "verification",
  locale = "en",
  account?: Partial<InferPublicSchema<typeof context>>,
) {
  const tools = (await agent.listTools({ requestContext: current(account) })) as unknown as Record<
    string,
    { execute: (input: { locale: string }, options: unknown) => Promise<{ guidance: string; link: string }> }
  >;
  const callable = tools[tool];
  assert(callable);
  return callable.execute({ locale }, { requestContext: current(account) });
}

function current(account?: Partial<InferPublicSchema<typeof context>>): RequestContext {
  return new RequestContext([
    ["account", account?.account],
    ["credentialId", account?.credentialId],
    ["whatsappId", me],
  ]);
}

function situation(generate: ReturnType<typeof generated>) {
  const options = (
    generate.mock.calls as unknown as [
      unknown,
      { requestContext?: RequestContext<InferPublicSchema<typeof context>> },
    ][]
  )[0]?.[1];
  assert(options?.requestContext);
  return options.requestContext;
}

async function jobFinished(id: string, jobOptions?: JobsOptions) {
  const job = await queue.add(
    "chat",
    { from: me, phoneNumberId: "321", text: "Hi!" },
    { attempts: 1, jobId: id, removeOnComplete: true, removeOnFail: true, ...jobOptions },
  );
  return job.waitUntilFinished(events);
}
