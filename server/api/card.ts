import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { Address } from "@exactly/common/validation";
import { captureException, setContext, setUser } from "@sentry/node";
import { Mutex } from "async-mutex";
import { eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import { parsePhoneNumberWithError } from "libphonenumber-js";
import {
  description,
  flatten,
  integer,
  literal,
  maxValue,
  minValue,
  number,
  object,
  parse,
  picklist,
  pipe,
  strictObject,
  string,
  title,
  transform,
  union,
  url,
  uuid,
  variant,
  type InferOutput,
} from "valibot";

import database, { cards, credentials } from "../database";
import auth from "../middleware/auth";
import { createCard as createCryptomateCard, getPAN } from "../utils/cryptomate";
import { createCard, getCard, getPIN, getSecrets, getUser, isPanda, PANResponse, PIN, setPIN } from "../utils/panda";
import { CRYPTOMATE_TEMPLATE, getInquiry, PANDA_TEMPLATE } from "../utils/persona";
import { track } from "../utils/segment";

const mutexes = new Map<string, Mutex>();
function createMutex(credentialId: string) {
  const mutex = new Mutex();
  mutexes.set(credentialId, mutex);
  return mutex;
}

const Card = variant("provider", [
  pipe(
    object({
      provider: literal("panda"),
      lastFour: pipe(string(), title("Last four digits"), description("The last four digits of the card number.")),
      status: pipe(string(), title("Card status"), description("Current status of the card (e.g., ACTIVE, FROZEN).")),
      mode: pipe(
        number(),
        title("Card mode"),
        description("Operating mode of the card, often related to installment plans."),
      ),
      displayName: pipe(
        string(),
        title("Cardholder name"),
        description("Name of the cardholder as it appears on the card."),
      ),
      expirationMonth: pipe(
        string(),
        title("Expiration month"),
        description("Two-digit month of the card's expiration date (e.g., 01 for January)."),
      ),
      expirationYear: pipe(
        string(),
        title("Expiration year"),
        description("Four-digit year of the card's expiration date (e.g., 2025)."),
      ),
      ...PANResponse.entries,
    }),
    title("Panda"),
  ),
  pipe(
    object({
      provider: literal("cryptomate"),
      lastFour: pipe(string(), title("Last four digits"), description("The last four digits of the card number.")),
      status: pipe(string(), title("Card status"), description("Current status of the card (e.g., ACTIVE, FROZEN).")),
      mode: pipe(
        number(),
        title("Card mode"),
        description("Operating mode of the card, often related to installment plans."),
      ),
      url: pipe(string(), url(), title("PAN URL"), description("URL to retrieve the full card number (PAN).")),
    }),
    title("Cryptomate"),
  ),
]);

const NewCard = object({
  lastFour: pipe(string(), title("Last four digits"), description("The last four digits of the newly created card.")),
  status: pipe(string(), title("Card status"), description("Initial status of the newly created card.")),
});

const PatchedCard = union([
  object({ mode: pipe(number(), title("Card mode"), description("New operating mode for the card.")) }),
  object({
    status: pipe(
      picklist(["ACTIVE", "FROZEN"]),
      title("Card status"),
      description("New status for the card. Can be ACTIVE or FROZEN."),
    ),
  }),
]);

export default new Hono()
  .get(
    "/",
    describeRoute({
      summary: "Get card details",
      description:
        "Retrieves the details of the user's active card. This includes card provider information, status, mode, and PAN details if applicable. Requires KYC verification.",
      responses: {
        200: {
          description: "Card details",
          content: {
            "application/json": { schema: resolver(Card, { errorMode: "ignore" }) },
          },
        },
      },
      validateResponse: true,
    }),
    vValidator("header", object({ sessionid: string() }), (validation, c) => {
      if (!validation.success) {
        captureException(new Error("bad session id"), {
          contexts: { validation: { ...validation, flatten: flatten(validation.issues) } },
        });
        return c.json({ code: "bad session id", legacy: "bad session id" }, 400);
      }
    }),
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

      if (credential.cards.length > 0 && credential.cards[0]) {
        const { id, lastFour, status, mode } = credential.cards[0];
        if (await isPanda(account)) {
          const inquiry = await getInquiry(credentialId, PANDA_TEMPLATE);
          if (!inquiry) return c.json({ code: "no kyc", legacy: "kyc required" }, 403);
          if (inquiry.attributes.status !== "approved") {
            return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 403);
          }
          if (!credential.pandaId) return c.json({ code: "no panda", legacy: "no panda" }, 403);
          const [{ expirationMonth, expirationYear }, pan, { firstName, lastName }, pin] = await Promise.all([
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
            } satisfies InferOutput<typeof Card>,
            200,
          );
        }
        const inquiry = await getInquiry(credentialId, CRYPTOMATE_TEMPLATE);
        if (!inquiry) return c.json({ code: "no kyc", legacy: "kyc required" }, 403);
        if (inquiry.attributes.status !== "approved") {
          return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 403);
        }
        return c.json(
          { provider: "cryptomate" as const, url: await getPAN(id), lastFour, status, mode } satisfies InferOutput<
            typeof Card
          >,
          200,
        );
      } else {
        return c.json({ code: "no card", legacy: "card not found" }, 404);
      }
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Create a new card",
      description:
        "Creates a new card for the user. Ensures that a user does not have multiple active cards. Requires KYC verification.",
      responses: {
        200: {
          description: "Newly created card information",
          content: {
            "application/json": { schema: resolver(NewCard, { errorMode: "ignore" }) },
          },
        },
      },
      validateResponse: true,
    }),
    auth(),
    async (c) => {
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

          if (await isPanda(account)) {
            const inquiry = await getInquiry(credentialId, PANDA_TEMPLATE);
            if (!inquiry) return c.json({ code: "no kyc", legacy: "kyc not found" }, 403);
            if (inquiry.attributes.status !== "approved") {
              return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 403);
            }
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
            await database.insert(cards).values([{ id: card.id, credentialId, lastFour: card.last4 }]);
            return c.json({ lastFour: card.last4, status: card.status } satisfies InferOutput<typeof NewCard>, 200);
          }
          const inquiry = await getInquiry(credentialId, CRYPTOMATE_TEMPLATE);
          if (!inquiry) return c.json({ code: "no kyc", legacy: "kyc not found" }, 403);
          if (inquiry.attributes.status !== "approved") {
            return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 403);
          }
          if (credential.cards.length > 0) {
            return c.json({ code: "already created", legacy: "card already exists" }, 400);
          }

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

          const card = await createCryptomateCard({
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
    },
  )
  .patch(
    "/",
    describeRoute({
      summary: "Update card settings",
      description:
        "Updates the settings of the user's card, such as its mode (e.g., number of installments) or status (e.g., active, frozen).",
      responses: {
        200: {
          description: "Updated card settings",
          content: {
            "application/json": { schema: resolver(PatchedCard, { errorMode: "ignore" }) },
          },
        },
      },
      validateResponse: true,
    }),
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
          strictObject({ ...PIN.entries, sessionId: string() }),
          transform((patch) => ({ ...patch, type: "pin" as const })),
        ),
      ]),
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
              const { sessionId, type, ...pin } = patch;
              await setPIN(card.id, sessionId, pin);
              return c.json(pin, 200);
            }
          }
        })
        .finally(() => {
          if (!mutex.isLocked()) mutexes.delete(credentialId);
        });
    },
  );

const CardUUID = pipe(string(), uuid());
