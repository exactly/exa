import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { Address } from "@exactly/common/validation";
import { captureException, setContext, setUser } from "@sentry/node";
import { Mutex } from "async-mutex";
import { eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { validator as vValidator } from "hono-openapi/valibot";
import {
  integer,
  maxValue,
  minValue,
  number,
  object,
  parse,
  picklist,
  pipe,
  strictObject,
  string,
  transform,
  union,
  uuid,
} from "valibot";

import database, { cards, credentials } from "../database";
import auth from "../middleware/auth";
import { sendPushNotification } from "../utils/onesignal";
import { autoCredit, createCard, getCard, getPIN, getSecrets, getUser, setPIN } from "../utils/panda";
import { track } from "../utils/segment";
import validatorHook from "../utils/validatorHook";

const mutexes = new Map<string, Mutex>();
function createMutex(credentialId: string) {
  const mutex = new Mutex();
  mutexes.set(credentialId, mutex);
  return mutex;
}

export default new Hono()
  .get(
    "/",
    vValidator("header", object({ sessionid: string() }), validatorHook({ code: "bad session id", status: 400 })),
    auth(),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
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
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
      const account = parse(Address, credential.account);
      setUser({ id: account });
      if (!credential.pandaId) return c.json({ code: "no panda", legacy: "no panda" }, 403);
      if (credential.cards.length > 0 && credential.cards[0]) {
        const { id, lastFour, status, mode } = credential.cards[0];
        const [{ expirationMonth, expirationYear, limit }, pan, { firstName, lastName }, pin] = await Promise.all([
          getCard(id),
          getSecrets(id, c.req.valid("header").sessionid),
          getUser(credential.pandaId),
          getPIN(id, c.req.valid("header").sessionid),
        ]);
        return c.json(
          {
            ...pan,
            ...pin,
            displayName: `${firstName} ${lastName}`,
            expirationMonth,
            expirationYear,
            lastFour,
            mode,
            provider: "panda" as const,
            status,
            limit,
          },
          200,
        );
      } else {
        return c.json({ code: "no card", legacy: "card not found" }, 404);
      }
    },
  )
  .post("/", auth(), async (c) => {
    const { credentialId } = c.req.valid("cookie");
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
        if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
        const account = parse(Address, credential.account);
        setUser({ id: account });
        if (!credential.pandaId) return c.json({ code: "no panda", legacy: "panda id not found" }, 403);
        let cardCount = credential.cards.length;
        for (const card of credential.cards) {
          try {
            await getCard(parse(CardUUID, card.id));
          } catch (error) {
            if (
              error instanceof Error &&
              (error.message.startsWith("Invalid UUID") || error.message.startsWith("404"))
            ) {
              await database.update(cards).set({ status: "DELETED" }).where(eq(cards.id, card.id));
              cardCount--;
              setContext("cryptomate card deleted", { id: card.id });
            } else {
              throw error;
            }
          }
        }
        if (cardCount > 0) return c.json({ code: "already created", legacy: "card already exists" }, 400);
        const card = await createCard(credential.pandaId);
        let mode = 0;
        try {
          if (await autoCredit(account)) mode = 1;
        } catch (error) {
          captureException(error);
        }
        await database.insert(cards).values([{ id: card.id, credentialId, lastFour: card.last4, mode }]);
        track({ event: "CardIssued", userId: account });
        if (mode) {
          sendPushNotification({
            userId: account,
            headings: { en: "Card mode" },
            contents: { en: "Credit mode is active" },
          }).catch((error: unknown) => captureException(error));
        }
        return c.json({ lastFour: card.last4, status: card.status }, 200);
      })
      .finally(() => {
        if (!mutex.isLocked()) mutexes.delete(credentialId);
      });
  })
  .patch(
    "/",
    auth(),
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
        pipe(
          strictObject({ data: string(), iv: string(), sessionId: string() }),
          transform((patch) => ({ ...patch, type: "pin" as const })),
        ),
      ]),
      validatorHook(),
    ),
    async (c) => {
      const patch = c.req.valid("json");
      const { credentialId } = c.req.valid("cookie");
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
          if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
          const account = parse(Address, credential.account);
          setUser({ id: account });
          if (credential.cards.length === 0 || !credential.cards[0]) {
            return c.json({ code: "no card", legacy: "no card found" }, 404);
          }
          const card = credential.cards[0];
          switch (patch.type) {
            case "mode": {
              const { mode } = patch;
              if (card.mode === mode) return c.json({ code: "already set", mode, legacy: "already set" }, 400);
              await database.update(cards).set({ mode }).where(eq(cards.id, card.id));
              return c.json({ mode }, 200);
            }
            case "status": {
              const { status } = patch;
              if (card.status === status) return c.json({ code: "already set", status, legacy: "already set" }, 400);
              await database.update(cards).set({ status }).where(eq(cards.id, card.id));
              track({ userId: account, event: status === "FROZEN" ? "CardFrozen" : "CardUnfrozen" });
              return c.json({ status }, 200);
            }
            case "pin": {
              const { sessionId, data, iv } = patch;
              await setPIN(card.id, sessionId, { data, iv });
              return c.json({ data, iv }, 200);
            }
          }
        })
        .finally(() => {
          if (!mutex.isLocked()) mutexes.delete(credentialId);
        });
    },
  );

const CardUUID = pipe(string(), uuid());
