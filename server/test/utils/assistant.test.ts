import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { RedisStore } from "@mastra/redis";
import { parse, string } from "valibot";
import { afterAll, afterEach, assert, describe, expect, it, vi } from "vitest";

import appOrigin from "../../utils/appOrigin";
import assistant from "../../utils/assistant";
import createWhatsapp from "../../utils/chat";

import type { context } from "../../utils/assistant";
import type { InferPublicSchema } from "@mastra/core/schema";

const whatsapp = createWhatsapp({ from: "sender", key: "chat", token: "whatsapp" });
const store = new RedisStore({ id: "assistant", connectionString: parse(string(), process.env.REDIS_URL) });
const { agent, reply } = assistant("anthropic", whatsapp, store);
const me = "5491100000001";

describe("assistant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => store.close());

  it("hides the account tools until the number is associated", async () => {
    await expect(agent.listTools({ requestContext: situation() }).then(Object.keys)).resolves.toStrictEqual([
      "associate",
      "support",
    ]);
    await expect(
      agent.listTools({ requestContext: situation({ credentialId: "credential" }) }).then(Object.keys),
    ).resolves.toStrictEqual(["associate", "verification", "card", "transfers", "support"]);
  });

  it("tells the model the number is not associated", async () => {
    const instructions = await agent.getInstructions({ requestContext: situation() });

    expect(instructions).toContain("This number is not associated with any Exa account.");
    expect(instructions).not.toContain("This number is associated with an Exa account.");
  });

  it("tells the model the account behind an associated number", async () => {
    const instructions = await agent.getInstructions({
      requestContext: situation({ account: "0x69", credentialId: "credential" }),
    });

    expect(instructions).toContain("This number is associated with an Exa account.");
    expect(instructions).toContain("The account is 0x69.");
    expect(instructions).not.toContain("This number is not associated with any Exa account.");
  });

  it("composes a sign-in link that encodes the whatsapp id", async () => {
    const translate = vi.spyOn(Agent.prototype, "generate");
    const { guidance, link } = await execute("associate");
    const [url, close] = link.split("\n\n");

    expect(guidance).toContain("the link is appended to your reply for you");
    expect(url).toMatch(`${appOrigin}/whatsapp?token=`);
    expect(close).toContain("Sign in and follow the steps.");
    await expect(whatsapp.decode(new URL(url ?? "").searchParams.get("token") ?? "")).resolves.toBe(me);
    expect(translate).not.toHaveBeenCalled();
  });

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

  it("points at the app alone when there is nothing to introduce", async () => {
    await expect(execute("support").then(({ link }) => link)).resolves.toBe(appOrigin);
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

  it("replies with nothing when the model neither wrote nor called a tool", async () => {
    vi.spyOn(Agent.prototype, "generate").mockResolvedValue({ steps: [{ text: " " }], toolResults: [] } as never);

    await expect(reply("hi").then(({ text }) => text)).resolves.toBe("");
  });
});

async function execute(
  tool: "associate" | "card" | "support" | "transfers" | "verification",
  locale = "en",
  account?: Partial<InferPublicSchema<typeof context>>,
) {
  const tools = (await agent.listTools({ requestContext: situation(account) })) as unknown as Record<
    string,
    { execute: (input: { locale: string }, options: unknown) => Promise<{ guidance: string; link: string }> }
  >;
  const callable = tools[tool];
  assert(callable);
  return callable.execute({ locale }, { requestContext: situation(account) });
}

function situation(account?: Partial<InferPublicSchema<typeof context>>): RequestContext {
  return new RequestContext([
    ["account", account?.account],
    ["credentialId", account?.credentialId],
    ["whatsappId", me],
  ]);
}
