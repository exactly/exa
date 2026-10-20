import { captureException, setUser, withScope } from "@sentry/node";
import { and, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import {
  array,
  is,
  literal,
  metadata,
  number,
  object,
  parse,
  picklist,
  pipe,
  string,
  uuid,
  type InferOutput,
} from "valibot";

import { isBase } from "@exactly/common/generated/chain";
import {
  BASE_PRODUCT_ID,
  CLASSIC_PRODUCT_ID,
  PHYSICAL_SIGNATURE_PRODUCT_ID,
  PLATINUM_PRODUCT_ID,
  SIGNATURE_PRODUCT_ID,
} from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import { cards, credentials } from "../database/schema";
import ServiceError from "../utils/ServiceError";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type createPanda from "../utils/panda";
import type createSegment from "../utils/segment";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export default function route({
  auth,
  database,
  panda,
  segment,
}: {
  auth: Auth;
  database: NodePgDatabase<typeof schema>;
  panda: ReturnType<typeof createPanda>;
  segment: ReturnType<typeof createSegment>;
}) {
  return new Hono().get(
    "/",
    auth,
    describeRoute({
      summary: "Get cards",
      description: `
Retrieve every active, frozen, or deleted card of the authenticated user.

Each item includes the cardholder's display name, expiration date, last four digits, installments mode, status, type (\`physical\` or \`virtual\`), spending limit, and product id. Cards the provider reports as canceled are retired and returned as deleted. Legacy cards and deleted cards that fail to load from the provider are omitted, and a failed read of an active or frozen card fails the request.

Pass an active or frozen item's \`lastFour\` to \`GET /card\` or \`PATCH /card\` to select that card.
      `,
      tags: ["Card"],
      security: [{ credentialAuth: [] }],
      validateResponse: true,
      responses: {
        200: {
          description: "Cards information",
          content: { "application/json": { schema: resolver(CardsResponse, { errorMode: "ignore" }) } },
        },
        403: {
          description: "Forbidden",
          content: {
            "application/json": { schema: resolver(object({ code: literal("no panda") }), { errorMode: "ignore" }) },
          },
        },
      },
    }),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true, pandaId: true, source: true },
        with: {
          cards: {
            columns: { id: true, lastFour: true, status: true, mode: true, productId: true },
            where: and(
              inArray(cards.status, ["ACTIVE", "FROZEN", "DELETED"]),
              eq(cards.tenant, isBase ? "BASE" : "OP"),
            ),
            orderBy: cards.id,
          },
        },
      });
      if (!credential) return c.json({ code: "no credential" }, 500);
      const account = parse(Address, credential.account);
      setUser({ id: account });
      if (!credential.pandaId) return c.json({ code: "no panda" }, 403);
      const listed = credential.cards.filter(({ id }) => is(CardUUID, id));
      if (listed.length === 0) return c.json([], 200);
      const user = await panda.getUser(credential.pandaId).catch((error: unknown) => {
        if (
          !(error instanceof ServiceError) ||
          !(
            (error.status === 404 && error.name.includes("NotFound")) ||
            (error.status === 403 &&
              error.name.includes("Forbidden") &&
              error.message.toLowerCase().includes("not approved"))
          )
        ) {
          throw error;
        }
        if (error.status === 404 || listed.some(({ status }) => status === "ACTIVE")) {
          withScope((s) => {
            s.addEventProcessor((event) => {
              if (event.exception?.values?.[0]) event.exception.values[0].type = error.name;
              return event;
            });
            captureException(error, {
              level: "warning",
              fingerprint: ["{{ default }}", error.name],
              extra: {
                cardIds: listed.map(({ id }) => id),
                credentialId,
                pandaId: credential.pandaId,
                statuses: listed.map(({ status }) => status),
                userIssue: error.name,
              },
            });
          });
        }
        return null;
      });
      if (!user) return c.json({ code: "no panda" }, 403);
      const holders = new Map([[credential.pandaId, Promise.resolve(user)]]);
      function holder(userId: string) {
        const cached = holders.get(userId);
        if (cached) return cached;
        const pending = panda.getUser(userId);
        holders.set(userId, pending);
        return pending;
      }
      return c.json(
        (await Promise.all(
          listed.map(({ id, lastFour, status, mode, productId }) =>
            panda
              .getCard(id)
              .then(async ({ expirationMonth, expirationYear, limit, status: state, type, userId }) => {
                const { firstName, lastName } = await holder(userId);
                const canceled = state === "canceled" && status !== "DELETED";
                if (canceled) {
                  const [deleted] = await database
                    .update(cards)
                    .set({ status: "DELETED" })
                    .where(and(eq(cards.id, id), ne(cards.status, "DELETED")))
                    .returning({ id: cards.id });
                  if (deleted) {
                    segment.track({
                      userId: account,
                      event: "CardDeleted",
                      properties: { cardId: id, source: credential.source },
                    });
                  }
                }
                return {
                  displayName: `${firstName} ${lastName}`,
                  expirationMonth,
                  expirationYear,
                  lastFour,
                  mode,
                  status: canceled ? ("DELETED" as const) : status,
                  type,
                  limit,
                  productId: parse(CardsResponse.item.entries.productId, productId),
                };
              })
              .catch((error: unknown): undefined => {
                if (status !== "DELETED") throw error;
                captureException(error, { level: "error", extra: { cardId: id, credentialId } });
              }),
          ),
        ).then((profiles) => profiles.filter((profile) => profile !== undefined))) satisfies InferOutput<
          typeof CardsResponse
        >,
        200,
      );
    },
  );
}

const CardUUID = pipe(string(), uuid());

const CardsResponse = array(
  object({
    displayName: pipe(string(), metadata({ examples: ["John Doe"] })),
    expirationMonth: pipe(string(), metadata({ examples: ["12"] })),
    expirationYear: pipe(string(), metadata({ examples: ["2025"] })),
    lastFour: pipe(string(), metadata({ examples: ["1234"] })),
    mode: pipe(number(), metadata({ examples: [0] })),
    status: pipe(picklist(["ACTIVE", "DELETED", "FROZEN"]), metadata({ examples: ["ACTIVE", "DELETED", "FROZEN"] })),
    type: pipe(picklist(["physical", "virtual"]), metadata({ examples: ["physical", "virtual"] })),
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
    productId: pipe(
      picklist([
        BASE_PRODUCT_ID,
        CLASSIC_PRODUCT_ID,
        PHYSICAL_SIGNATURE_PRODUCT_ID,
        PLATINUM_PRODUCT_ID,
        SIGNATURE_PRODUCT_ID,
      ]),
      metadata({
        examples: [
          BASE_PRODUCT_ID,
          CLASSIC_PRODUCT_ID,
          PHYSICAL_SIGNATURE_PRODUCT_ID,
          PLATINUM_PRODUCT_ID,
          SIGNATURE_PRODUCT_ID,
        ],
      }),
    ),
  }),
);
