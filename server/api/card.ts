import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";
import { captureException, setContext, setUser } from "@sentry/node";
import { Mutex } from "async-mutex";
import { eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import {
  integer,
  literal,
  maxValue,
  metadata,
  minValue,
  number,
  object,
  parse,
  picklist,
  pipe,
  nullable,
  strictObject,
  string,
  transform,
  union,
  uuid,
  type InferOutput,
} from "valibot";

import database, { cards, credentials } from "../database";
import auth from "../middleware/auth";
import { getApplicationStatus } from "../utils/kyc";
import { sendPushNotification } from "../utils/onesignal";
import { autoCredit, createCard, getCard, getPIN, getSecrets, getUser, setPIN, updateCard } from "../utils/panda";
import { track } from "../utils/segment";
import validatorHook from "../utils/validatorHook";

const mutexes = new Map<string, Mutex>();
function createMutex(credentialId: string) {
  const mutex = new Mutex();
  mutexes.set(credentialId, mutex);
  return mutex;
}

const BadRequestCodes = {
  NO_PANDA: "no panda",
  BAD_REQUEST: "bad request",
  ALREADY_CREATED: "already created",
  ALREADY_SET: "already set",
} as const;

const CardResponse = object({
  displayName: pipe(string(), metadata({ examples: ["John Doe"] })),
  encryptedPan: object({
    data: string(),
    iv: string(),
  }),
  encryptedCvc: object({
    data: string(),
    iv: string(),
  }),
  expirationMonth: pipe(string(), metadata({ examples: ["12"] })),
  expirationYear: pipe(string(), metadata({ examples: ["2025"] })),
  lastFour: pipe(string(), metadata({ examples: ["1234"] })),
  mode: pipe(number(), metadata({ examples: [0] })),
  pin: nullable(
    object({
      data: string(),
      iv: string(),
    }),
  ),
  provider: pipe(literal("panda"), metadata({ examples: ["panda"] })),
  status: pipe(picklist(["ACTIVE", "FROZEN"]), metadata({ examples: ["ACTIVE", "FROZEN"] })),
  limit: object({
    amount: number(),
    frequency: picklist([
      "per24HourPeriod",
      "per7DayPeriod",
      "per30DayPeriod",
      "perYearPeriod",
      "allTime",
      "perAuthorization",
    ]),
  }),
  productId: pipe(string(), metadata({ examples: ["402"] })),
});

const CreatedCardResponse = object({
  lastFour: pipe(string(), metadata({ examples: ["1234"] })),
  status: pipe(picklist(["ACTIVE", "DELETED", "FROZEN"]), metadata({ examples: ["ACTIVE", "DELETED", "FROZEN"] })),
  productId: pipe(string(), metadata({ examples: ["402"] })),
});

const UpdateCard = union([
  pipe(
    strictObject({ mode: pipe(number(), integer(), minValue(0), maxValue(MAX_INSTALLMENTS)) }),
    transform((patch) => ({ ...patch, type: "mode" as const })),
  ),
  pipe(
    strictObject({ status: picklist(["ACTIVE", "DELETED", "FROZEN"]) }),
    transform((patch) => ({ ...patch, type: "status" as const })),
  ),
  pipe(
    strictObject({ data: string(), iv: string(), sessionId: string() }),
    transform((patch) => ({ ...patch, type: "pin" as const })),
  ),
]);

const UpdatedCardResponse = union([
  object({
    data: string(),
    iv: string(),
  }),
  object({
    mode: pipe(number(), metadata({ examples: [0] })),
  }),
  object({
    status: pipe(picklist(["ACTIVE", "DELETED", "FROZEN"]), metadata({ examples: ["ACTIVE", "DELETED", "FROZEN"] })),
  }),
]);

export default new Hono()
  .get(
    "/",
    vValidator("header", object({ sessionid: string() }), validatorHook({ code: "bad session id", status: 400 })),
    auth(),
    describeRoute({
      summary: "Get card information",
      description: `
Retrieve the card profile and encrypted card data for an authenticated user.

**Retrieving encrypted card details**
1. **Generate a session ID**: Encrypt a 32‑character hexadecimal secret (no spaces/dashes) with the provided public RSA key using RSA‑OAEP.
2. **Send the request**: Include the encrypted secret in the header \`sessionid\` when calling this endpoint.
3. **Decrypt the response**: Use the original secret to decrypt \`encryptedPan\`, \`encryptedCvc\`, and \`pin\` (each returned as \`{ data, iv }\`).

**Step 1: Generate a sessionid and secret**

\`\`\`typescript
import crypto from "node:crypto";

function session(): { sessionid: string; secret: string } {
  const secret = crypto.randomUUID().replaceAll("-", "");
  const secretKeyBase64 = Buffer.from(secret, "hex").toString("base64");
  const secretKeyBase64Buffer = Buffer.from(secretKeyBase64, "utf8");
  const secretKeyBase64BufferEncrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    secretKeyBase64Buffer,
  );
  return {
    sessionid: secretKeyBase64BufferEncrypted.toString("base64"),
    secret,
  };
}
\`\`\`

The \`sessionid\` is required to make an API request.
The \`secret\` will be needed for decryption later.

**Step 2: Send the request**

Use the \`sessionid\` in the header when calling this endpoint.

**Step 3: Decrypt the response**

Use the \`secret\` from Step 1 to decrypt the data.

\`\`\`typescript
import crypto from "node:crypto";

function decrypt(base64Secret: string, base64Iv: string, secretKey: string): string {
  const secret = Buffer.from(base64Secret, "base64");
  const iv = Buffer.from(base64Iv, "base64");
  const decipher = crypto.createDecipheriv("aes-128-gcm", Buffer.from(secretKey, "hex"), iv);
  decipher.setAutoPadding(false);
  decipher.setAuthTag(secret.subarray(-16));
  return Buffer.concat([decipher.update(secret.subarray(0, -16)), decipher.final()]).toString("utf8");
}
\`\`\`

`,
      tags: ["Card"],
      security: [{ credentialAuth: [] }],
      validateResponse: true,
      responses: {
        200: {
          description: "Card information",
          content: {
            "application/json": {
              schema: resolver(CardResponse, { errorMode: "ignore" }),
            },
          },
        },
        400: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: resolver(buildBaseResponse(BadRequestCodes.BAD_REQUEST), { errorMode: "ignore" }),
            },
          },
        },
        403: {
          description: "Forbidden",
          content: {
            "application/json": {
              schema: resolver(buildBaseResponse(BadRequestCodes.NO_PANDA), { errorMode: "ignore" }),
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(literal("no card"), metadata({ examples: ["no card"] })),
                  legacy: pipe(literal("card not found"), metadata({ examples: ["card not found"] })),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true, pandaId: true },
        with: {
          cards: {
            columns: { id: true, lastFour: true, status: true, mode: true, productId: true },
            where: inArray(cards.status, ["ACTIVE", "FROZEN"]),
          },
        },
      });
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
      const account = parse(Address, credential.account);
      setUser({ id: account });
      if (!credential.pandaId) return c.json({ code: BadRequestCodes.NO_PANDA, legacy: BadRequestCodes.NO_PANDA }, 403);
      if (credential.cards.length > 0 && credential.cards[0]) {
        const { id, lastFour, status, mode, productId } = credential.cards[0];
        if (status === "DELETED") throw new Error("card deleted");
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
            productId,
          } satisfies InferOutput<typeof CardResponse>,
          200,
        );
      } else {
        return c.json({ code: "no card", legacy: "card not found" }, 404);
      }
    },
  )
  .post(
    "/",
    auth(),
    describeRoute({
      summary: "Create card",
      tags: ["Card"],
      validateResponse: true,
      security: [{ credentialAuth: [] }],
      responses: {
        200: {
          description: "Card created",
          content: {
            "application/json": {
              schema: resolver(CreatedCardResponse, { errorMode: "ignore" }),
            },
          },
        },
        400: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: resolver(
                union([
                  buildBaseResponse(BadRequestCodes.BAD_REQUEST),
                  object({
                    code: string(BadRequestCodes.ALREADY_CREATED),
                    legacy: string("card already exists"),
                  }),
                ]),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        403: {
          description: "Forbidden",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: string(BadRequestCodes.NO_PANDA),
                  legacy: string("panda id not found"),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
      },
    }),
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

          if (!credential.pandaId) return c.json({ code: "no panda", legacy: "panda id not found" }, 403);
          const kyc = await getApplicationStatus(credential.pandaId);
          if (kyc.applicationStatus !== "approved") {
            return c.json({ code: "kyc not approved", legacy: "kyc not approved" }, 403);
          }
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
          const card = await createCard(credential.pandaId, SIGNATURE_PRODUCT_ID);
          let mode = 0;
          try {
            if (await autoCredit(account)) mode = 1;
          } catch (error) {
            captureException(error);
          }
          await database
            .insert(cards)
            .values([{ id: card.id, credentialId, lastFour: card.last4, mode, productId: SIGNATURE_PRODUCT_ID }]);
          track({ event: "CardIssued", userId: account, properties: { productId: SIGNATURE_PRODUCT_ID } });
          if (mode) {
            sendPushNotification({
              userId: account,
              headings: { en: "Card mode" },
              contents: { en: "Credit mode is active" },
            }).catch((error: unknown) => captureException(error));
          }
          return c.json(
            { lastFour: card.last4, status: "ACTIVE", productId: SIGNATURE_PRODUCT_ID } satisfies InferOutput<
              typeof CreatedCardResponse
            >,
            200,
          );
        })
        .finally(() => {
          if (!mutex.isLocked()) mutexes.delete(credentialId);
        });
    },
  )
  .patch(
    "/",
    auth(),
    describeRoute({
      summary: "Update card",
      tags: ["Card"],
      validateResponse: true,
      security: [{ credentialAuth: [] }],
      description: `
Update the card status, PIN, or installments mode.

**Updating the card status**

- ACTIVE: The card is active and can be used.
- FROZEN: The card is frozen and cannot be used but may be active in the future.
- DELETED: The card is deleted and cannot be used permanently.

**Updating the card PIN**

1. **Encrypt the PIN**: Format and encrypt the PIN using the session secret.
2. **Submit the update**: Send the encrypted PIN with the \`sessionId\` to update the card.

**PIN Requirements**
- Length must be between 4–12 digits.
- No simple sequences (e.g., 1234, 0000)
- No repeated numbers (e.g., 1111, 2222)

**PIN Encryption Format**

\`\`\`typescript
async function encryptPIN(pin: string) {
  if (pin.length < 4 || pin.length > 12) throw new Error("PIN must be between 4–12 digits");
  const data = \`2\${pin.length.toString(16)}\${pin}\${"F".repeat(14 - pin.length)}\`;

  const secret = crypto.randomUUID().replaceAll("-", "");
  const secretKeyBase64 = Buffer.from(secret, "hex").toString("base64");
  const secretKeyBase64Buffer = Buffer.from(secretKeyBase64, "utf8");
  const secretKeyBase64BufferEncrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    secretKeyBase64Buffer,
  );
  const sessionId = secretKeyBase64BufferEncrypted.toString("base64");
  
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", Buffer.from(secret, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  return {
    data: Buffer.concat([encrypted, authTag]).toString("base64"),
    iv: iv.toString("base64"),
    sessionId,
  };
}
\`\`\`

`,
      responses: {
        200: {
          description: "Card updated",
          content: {
            "application/json": {
              schema: resolver(UpdatedCardResponse, { errorMode: "ignore" }),
            },
          },
        },
        400: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: resolver(
                union([buildBaseResponse(BadRequestCodes.BAD_REQUEST), buildBaseResponse(BadRequestCodes.ALREADY_SET)]),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(literal("no card"), metadata({ examples: ["no card"] })),
                  legacy: pipe(literal("card not found"), metadata({ examples: ["card not found"] })),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
      },
    }),
    vValidator("json", UpdateCard, validatorHook()),
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
              if (card.mode === mode)
                return c.json({ code: BadRequestCodes.ALREADY_SET, mode, legacy: BadRequestCodes.ALREADY_SET }, 400);
              await database.update(cards).set({ mode }).where(eq(cards.id, card.id));
              return c.json({ mode } satisfies InferOutput<typeof UpdatedCardResponse>, 200);
            }
            case "status": {
              const { status } = patch;
              if (card.status === status)
                return c.json({ code: BadRequestCodes.ALREADY_SET, status, legacy: BadRequestCodes.ALREADY_SET }, 400);
              switch (status) {
                case "ACTIVE":
                  track({ userId: account, event: "CardUnfrozen" });
                  break;
                case "DELETED":
                  await updateCard({ id: card.id, status: "canceled" });
                  track({ userId: account, event: "CardDeleted" });
                  break;
                case "FROZEN":
                  track({ userId: account, event: "CardFrozen" });
                  break;
              }
              await database.update(cards).set({ status }).where(eq(cards.id, card.id));
              return c.json({ status } satisfies InferOutput<typeof UpdatedCardResponse>, 200);
            }
            case "pin": {
              const { sessionId, data, iv } = patch;
              await setPIN(card.id, sessionId, { data, iv });
              return c.json({ data, iv } satisfies InferOutput<typeof UpdatedCardResponse>, 200);
            }
          }
        })
        .finally(() => {
          if (!mutex.isLocked()) mutexes.delete(credentialId);
        });
    },
  );

const CardUUID = pipe(string(), uuid());

function buildBaseResponse(example = "string") {
  return object({
    code: pipe(string(), metadata({ examples: [example] })),
    legacy: pipe(string(), metadata({ examples: [example] })),
  });
}
