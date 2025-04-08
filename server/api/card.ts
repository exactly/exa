import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { Address } from "@exactly/common/validation";
import { vValidator } from "@hono/valibot-validator";
import { setContext, setUser } from "@sentry/node";
import { Mutex } from "async-mutex";
import { eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { parsePhoneNumberWithError } from "libphonenumber-js";
import { integer, maxValue, minValue, number, parse, picklist, pipe, strictObject, transform, union } from "valibot";

import database, { cards, credentials } from "../database";
import auth from "../middleware/auth";
import { createCard, getPAN } from "../utils/cryptomate";
import { createCard as createPandaCard, displayName, getCard, getSecrets, isPanda, pandaIssuing } from "../utils/panda";
import { getInquiry, templates } from "../utils/persona";
import { track } from "../utils/segment";

const mutexes = new Map<string, Mutex>();
function createMutex(credentialId: string) {
  const mutex = new Mutex();
  mutexes.set(credentialId, mutex);
  return mutex;
}

const app = new Hono();
app.use(auth);

export default app
  .get("/", async (c) => {
    const credentialId = c.get("credentialId");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, pandaId: true },
      with: {
        cards: {
          columns: { id: true, lastFour: true, status: true, mode: true },
          where: inArray(cards.status, ["ACTIVE", "FROZEN"]),
        },
      },
    });
    if (!credential) return c.json("credential not found", 401);
    const account = parse(Address, credential.account);
    setUser({ id: account });

    if (credential.cards.length > 0 && credential.cards[0]) {
      const { id, lastFour, status, mode } = credential.cards[0];
      if (await isPanda(account)) {
        const inquiry = await getInquiry(credentialId, templates.panda);
        if (!inquiry) return c.json("kyc required", 403);
        if (inquiry.attributes.status !== "approved") return c.json("kyc not approved", 403);
        if (!credential.pandaId) return c.json("panda id not found", 400);
        const session = c.req.header("SessionId");
        if (!session) return c.json("SessionId header required", 400);
        const [pan, { expirationMonth, expirationYear }] = await Promise.all([getSecrets(id, session), getCard(id)]);
        return c.json(
          {
            ...pan,
            provider: "panda" as const,
            displayName: displayName({
              first: inquiry.attributes["name-first"],
              middle: inquiry.attributes["name-middle"],
              last: inquiry.attributes["name-last"],
            }),
            expirationMonth,
            expirationYear,
            lastFour,
            status,
            mode,
          },
          200,
        );
      }
      const inquiry = await getInquiry(credentialId, templates.cryptomate);
      if (!inquiry) return c.json("kyc required", 403);
      if (inquiry.attributes.status !== "approved") return c.json("kyc not approved", 403);
      return c.json({ provider: "cryptomate" as const, url: await getPAN(id), lastFour, status, mode }, 200);
    } else {
      return c.json("card not found", 404);
    }
  })
  .post("/", async (c) => {
    const credentialId = c.get("credentialId");
    const mutex = mutexes.get(credentialId) ?? createMutex(credentialId);
    return mutex
      .runExclusive(async () => {
        const credential = await database.query.credentials.findFirst({
          where: eq(credentials.id, credentialId),
          columns: { account: true, pandaId: true },
          with: {
            cards: { columns: { id: true, status: true }, where: inArray(cards.status, ["ACTIVE", "FROZEN"]) },
          },
        });
        if (!credential) return c.json("credential not found", 401);
        const account = parse(Address, credential.account);
        setUser({ id: account });

        if (pandaIssuing && (await isPanda(account))) {
          const inquiry = await getInquiry(credentialId, templates.panda);
          if (!inquiry) return c.json("kyc not found", 404);
          if (inquiry.attributes.status !== "approved") return c.json("kyc not approved", 403);
          if (!credential.pandaId) return c.json("panda id not found", 400);
          let cardCount = credential.cards.length;
          for (const card of credential.cards) {
            try {
              await getCard(card.id);
            } catch (error) {
              if (error instanceof Error && (error.message === "invalid card id" || error.message.startsWith("404"))) {
                await database.update(cards).set({ status: "DELETED" }).where(eq(cards.id, card.id));
                cardCount--;
                setContext("cryptomate card deleted", { id: card.id });
              } else {
                throw error;
              }
            }
          }
          if (cardCount > 0) return c.json(`card already exists: ${cardCount}`, 400);
          const card = await createPandaCard({
            userId: credential.pandaId,
            name: {
              first: inquiry.attributes["name-first"],
              middle: inquiry.attributes["name-middle"],
              last: inquiry.attributes["name-last"],
            },
          });
          await database.insert(cards).values([{ id: card.id, credentialId, lastFour: card.last4 }]);
          return c.json({ lastFour: card.last4, status: card.status }, 200);
        }
        const inquiry = await getInquiry(credentialId, templates.cryptomate);
        if (!inquiry) return c.json("kyc not found", 404);
        if (inquiry.attributes.status !== "approved") return c.json("kyc not approved", 403);
        if (credential.cards.length > 0) return c.json("card already exists", 400);

        setContext("phone", { inquiry: inquiry.id, phone: inquiry.attributes["phone-number"] });
        const phone = parsePhoneNumberWithError(
          inquiry.attributes["phone-number"].startsWith("+")
            ? inquiry.attributes["phone-number"]
            : `+${inquiry.attributes["phone-number"]}`,
        );
        setContext("phone", {
          inquiry: inquiry.id,
          phone: inquiry.attributes["phone-number"],
          countryCode: phone.countryCallingCode,
          number: phone.nationalNumber,
        });

        const card = await createCard({
          account,
          email: inquiry.attributes["email-address"],
          name: {
            first: inquiry.attributes["name-first"],
            middle: inquiry.attributes["name-middle"],
            last: inquiry.attributes["name-last"],
          },
          phone: { countryCode: phone.countryCallingCode, number: phone.nationalNumber },
          limits: { daily: 3000, weekly: 10_000, monthly: 30_000 },
        });
        await database.insert(cards).values([{ id: card.id, credentialId, lastFour: card.last4 }]);
        return c.json({ url: await getPAN(card.id), lastFour: card.last4, status: card.status }, 200); // TODO review if necessary
      })
      .finally(() => {
        if (!mutex.isLocked()) mutexes.delete(credentialId);
      });
  })
  .patch(
    "/",
    vValidator(
      "json",
      union([
        pipe(
          strictObject({ mode: pipe(number(), integer(), minValue(0), maxValue(MAX_INSTALLMENTS)) }),
          transform((patch) => ({ ...patch, type: "mode" as const })),
        ),
        pipe(
          strictObject({ status: picklist(["ACTIVE", "FROZEN"]) }),
          transform((patch) => ({ ...patch, type: "status" as const })),
        ),
      ]),
    ),
    async (c) => {
      const patch = c.req.valid("json");
      const credentialId = c.get("credentialId");
      const mutex = mutexes.get(credentialId) ?? createMutex(credentialId);
      return mutex
        .runExclusive(async () => {
          const credential = await database.query.credentials.findFirst({
            columns: { account: true },
            where: eq(credentials.id, credentialId),
            with: {
              cards: { columns: { id: true, mode: true, status: true }, where: ne(cards.status, "DELETED") },
            },
          });
          if (!credential) return c.json("credential not found", 401);
          const account = parse(Address, credential.account);
          setUser({ id: account });
          if (credential.cards.length === 0 || !credential.cards[0]) return c.json("no card found", 404);
          const card = credential.cards[0];
          switch (patch.type) {
            case "mode": {
              const { mode } = patch;
              if (card.mode === mode) return c.json(`card mode is already ${mode}`, 400);
              await database.update(cards).set({ mode }).where(eq(cards.id, card.id));
              return c.json({ mode }, 200);
            }
            case "status": {
              const { status } = patch;
              if (card.status === status) return c.json(`card is already ${status.toLowerCase()}`, 400);
              await database.update(cards).set({ status }).where(eq(cards.id, card.id));
              track({ userId: account, event: status === "FROZEN" ? "CardFrozen" : "CardUnfrozen" });
              return c.json({ status }, 200);
            }
          }
        })
        .finally(() => {
          if (!mutex.isLocked()) mutexes.delete(credentialId);
        });
    },
  );
