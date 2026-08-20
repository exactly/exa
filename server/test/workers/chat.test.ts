import "../mocks/sentry";

import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { captureException } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import { parse, string } from "valibot";
import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import appOrigin from "../../utils/appOrigin";
import { attempts } from "../../workers/chat/job";
import createChat from "../../workers/chat/queue";
import createChatWorker, { compose } from "../../workers/chat/worker";
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
const { agent, reply } = compose("anthropic");
const welcome = `Hi, welcome to Exa!
With Exa you choose whether to pay for your purchases instantly with your balance or in fixed-rate installments, without selling your digital assets.
You also get access to a dollar account in the US, all 100% free.
Create your account and activate your card here: ${appOrigin}`;
const help = `Hi again. Almost everything you need to know about the Exa Card is in our help center: credit limit, identity verification, billing address, installments and payments.
Search for your topic here: https://help.exactly.app
If you don't find the answer there, write to us from the support chat inside the Exa app: ${appOrigin}/support`;

let worker: ReturnType<typeof createChatWorker>;

afterAll(async () => {
  await Promise.all([publisher.close(), queue.close(), events.close()]);
  await bullmq.quit();
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
  await bullmq.del("whatsapp:seen:US.12345678");
});

describe("chat composition", () => {
  it("offers only the welcome to someone writing for the first time", async () => {
    await expect(listTools(false)).resolves.toStrictEqual(["welcome"]);
  });

  it("offers only the help to someone who wrote before", async () => {
    await expect(listTools(true)).resolves.toStrictEqual(["help"]);
  });

  it("asks the model for the script the redis key chose", async () => {
    expect(await agent.getInstructions({ requestContext: requestContext(false) })).toContain("calling welcome");
    expect(await agent.getInstructions({ requestContext: requestContext(true) })).toContain("calling help");
  });

  it("welcomes in english without translating", async () => {
    const translate = vi.spyOn(Agent.prototype, "generate");
    await expect(execute(false, "en-US")).resolves.toStrictEqual({ text: welcome });
    expect(translate).not.toHaveBeenCalled();
  });

  it("sends the help center and support links in english", async () => {
    const translate = vi.spyOn(Agent.prototype, "generate");
    await expect(execute(true, "en")).resolves.toStrictEqual({ text: help });
    expect(translate).not.toHaveBeenCalled();
  });

  it("translates every block into the language the person wrote in", async () => {
    const translate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValueOnce({ text: "  ¡Hola de nuevo!  " } as never) // cspell:ignore Hola nuevo
      .mockResolvedValueOnce({ text: "Escribinos por soporte:" } as never); // cspell:ignore Escribinos soporte
    await expect(execute(true, "es-AR")).resolves.toStrictEqual({
      text: `¡Hola de nuevo! https://help.exactly.app\nEscribinos por soporte: ${appOrigin}/support`, // cspell:ignore Hola nuevo Escribinos soporte
    });
    expect(translate).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenCalledWith(expect.stringContaining("Translate to es-AR:") as never);
  });

  it("replies with what the script composed", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate").mockResolvedValue({
      toolResults: [{ payload: { result: { guidance: "nothing" } } }, { payload: { result: { text: "hola!" } } }], // cspell:ignore hola
    } as never);
    await expect(reply("hello", { requestContext: requestContext(false) }).then(({ text }) => text)).resolves.toBe(
      "hola!", // cspell:ignore hola
    );
    expect(generate).toHaveBeenCalledExactlyOnceWith("hello", {
      requestContext: requestContext(false),
      maxSteps: 1,
      toolChoice: "required",
    });
  });

  it("fails instead of replying with nothing when no script was composed", async () => {
    vi.spyOn(Agent.prototype, "generate").mockResolvedValue({ toolResults: [] } as never);
    await expect(reply("hi")).rejects.toThrow("no script composed");
  });
});

describe("chat queue", () => {
  it("publishes a retryable job", async () => {
    await publisher.enqueue({ contact: "Jhon", from: "US.12345678", id: "whatsapp-queue", text: "Hi!" }); // cspell:ignore Jhon
    const job = await queue.getJob("whatsapp-queue");
    if (!job) throw new Error("job not found");
    expect(job.name).toBe("chat");
    expect(job.data).toStrictEqual({
      contact: "Jhon", // cspell:ignore Jhon
      from: "US.12345678",
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
    await expect(publisher.enqueue({ from: "US.12345678", id: "whatsapp-failure", text: "Hi!" })).rejects.toThrow(
      error,
    );
  });
});

describe("chat worker", () => {
  afterAll(async () => {
    await worker.close();
  });

  beforeAll(async () => {
    const dedicated = connect(redisUrl);
    worker = createChatWorker({
      anthropicKey: "anthropic",
      bullmq: dedicated,
      close: () => dedicated.quit(),
      whatsappFrom: "321",
      whatsappToken: "token",
    });
    await worker.ready;
  });

  it("replies to an unseen sender and records the message", async () => {
    const generate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValue({ toolResults: [{ payload: { result: { text: "sure!" } } }] } as never);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    await jobFinished("whatsapp-new");
    expect(generate).toHaveBeenCalledExactlyOnceWith("Hi!", options(false));
    expect(send).toHaveBeenCalledExactlyOnceWith("https://graph.facebook.com/v26.0/321/messages", {
      method: "POST",
      headers: { authorization: "Bearer token", accept: "application/json", "content-type": "application/json" },
      signal: expect.anything() as AbortSignal,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        recipient: "US.12345678",
        type: "text",
        text: { body: "sure!" },
      }),
    });
    await expect(bullmq.get("whatsapp:seen:US.12345678")).resolves.toBe("whatsapp-new");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("uses the help script for a sender who wrote before", async () => {
    await bullmq.set("whatsapp:seen:US.12345678", "whatsapp-first");
    const generate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValue({ toolResults: [{ payload: { result: { text: "hi again!" } } }] } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    await jobFinished("whatsapp-returning");
    expect(generate).toHaveBeenCalledExactlyOnceWith("Hi!", options(true));
    await expect(bullmq.get("whatsapp:seen:US.12345678")).resolves.toBe("whatsapp-first");
  });

  it("reports a model failure after the final attempt", async () => {
    vi.spyOn(Agent.prototype, "generate").mockRejectedValue(new Error("model down"));
    await expect(jobFinished("whatsapp-model-failure")).rejects.toThrow("model down");
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("model down"), {
      extra: { attempts: 1, from: "US.12345678", id: "whatsapp-model-failure" },
      level: "fatal",
    });
    await expect(bullmq.exists("whatsapp:seen:US.12345678")).resolves.toBe(0);
  });

  it("reports a rejected WhatsApp delivery", async () => {
    vi.spyOn(Agent.prototype, "generate").mockResolvedValue({
      toolResults: [{ payload: { result: { text: "sure!" } } }],
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("too many messages", { status: 429 }));
    await expect(jobFinished("whatsapp-send-failure")).rejects.toThrow("too many messages");
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "WhatsApp429", message: "too many messages" }) as Error,
      { extra: { attempts: 1, from: "US.12345678", id: "whatsapp-send-failure" }, level: "fatal" },
    );
  });

  it("captures redis errors instead of crashing", async () => {
    const listen = vi.spyOn(Redis.prototype, "on");
    const dedicated = connect(redisUrl);
    const observed = createChatWorker({
      anthropicKey: "anthropic",
      bullmq: dedicated,
      close: () => dedicated.quit(),
      whatsappFrom: "321",
      whatsappToken: "token",
    });
    const listener = listen.mock.calls.find(([event]) => event === "error")?.[1];
    if (!listener) throw new Error("missing error listener");
    listener(new Error("socket closed"));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("socket closed"));
    await observed.close();
  });

  it("closes in idempotent way", async () => {
    const dedicated = connect(redisUrl);
    const observed = createChatWorker({
      anthropicKey: "anthropic",
      bullmq: dedicated,
      close: () => dedicated.quit(),
      whatsappFrom: "321",
      whatsappToken: "token",
    });
    await observed.ready;
    await expect(Promise.all([observed.close(), observed.close()])).resolves.toStrictEqual([undefined, undefined]);
  });
});

const requestContext = (seen: boolean): RequestContext => new RequestContext([["seen", seen]]);
const options = (seen: boolean) => ({
  requestContext: new RequestContext<InferPublicSchema<typeof context>>([["seen", seen]]),
  maxSteps: 1,
  toolChoice: "required",
});

function listTools(seen: boolean) {
  return agent.listTools({ requestContext: requestContext(seen) }).then(Object.keys);
}

async function execute(seen: boolean, locale: string) {
  const [tool] = Object.values(
    (await agent.listTools({ requestContext: requestContext(seen) })) as unknown as Record<
      string,
      { execute: (input: { locale: string }) => Promise<{ text: string }> }
    >,
  );
  assert(tool);
  return tool.execute({ locale });
}

async function jobFinished(id: string, jobOptions?: JobsOptions) {
  const job = await queue.add(
    "chat",
    { from: "US.12345678", text: "Hi!" },
    { attempts: 1, jobId: id, removeOnComplete: true, removeOnFail: true, ...jobOptions },
  );
  return job.waitUntilFinished(events);
}
