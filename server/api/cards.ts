import { captureException, setUser, withScope } from "@sentry/node";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import { array, literal, metadata, number, object, parse, picklist, pipe, string, type InferOutput } from "valibot";

import { BASE_PRODUCT_ID, PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import { cards, credentials } from "../database/schema";
import ServiceError from "../utils/ServiceError";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type createPanda from "../utils/panda";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export default function route({
  auth,
  database,
  panda,
}: {
  auth: Auth;
  database: NodePgDatabase<typeof schema>;
  panda: ReturnType<typeof createPanda>;
}) {
  return new Hono().get(
    "/",
    auth,
    describeRoute({
      summary: "Get cards",
      description: `
Retrieve every active, frozen, or deleted card of the authenticated user.

Each item includes the cardholder's display name, expiration date, last four digits, installments mode, status, spending limit, and product id. Cards that fail to load from the provider are omitted.

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
        columns: { account: true, pandaId: true },
        with: {
          cards: {
            columns: { id: true, lastFour: true, status: true, mode: true, productId: true },
            where: inArray(cards.status, ["ACTIVE", "FROZEN", "DELETED"]),
            orderBy: cards.id,
          },
        },
      });
      if (!credential) return c.json({ code: "no credential" }, 500);
      setUser({ id: parse(Address, credential.account) });
      if (!credential.pandaId) return c.json({ code: "no panda" }, 403);
      if (credential.cards.length === 0) return c.json([], 200);
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
        if (error.status === 404 || credential.cards.some(({ status }) => status === "ACTIVE")) {
          withScope((s) => {
            s.addEventProcessor((event) => {
              if (event.exception?.values?.[0]) event.exception.values[0].type = error.name;
              return event;
            });
            captureException(error, {
              level: "warning",
              fingerprint: ["{{ default }}", error.name],
              extra: {
                cardIds: credential.cards.map(({ id }) => id),
                credentialId,
                pandaId: credential.pandaId,
                statuses: credential.cards.map(({ status }) => status),
                userIssue: error.name,
              },
            });
          });
        }
        return null;
      });
      if (!user) return c.json({ code: "no panda" }, 403);
      return c.json(
        (await Promise.all(
          credential.cards.map(({ id, lastFour, status, mode, productId }) =>
            panda
              .getCard(id)
              .then(({ expirationMonth, expirationYear, limit }) => ({
                displayName: `${user.firstName} ${user.lastName}`,
                expirationMonth,
                expirationYear,
                lastFour,
                mode,
                status,
                limit,
                productId: parse(CardsResponse.item.entries.productId, productId),
              }))
              .catch((error: unknown): undefined => {
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

const CardsResponse = array(
  object({
    displayName: pipe(string(), metadata({ examples: ["John Doe"] })),
    expirationMonth: pipe(string(), metadata({ examples: ["12"] })),
    expirationYear: pipe(string(), metadata({ examples: ["2025"] })),
    lastFour: pipe(string(), metadata({ examples: ["1234"] })),
    mode: pipe(number(), metadata({ examples: [0] })),
    status: pipe(picklist(["ACTIVE", "DELETED", "FROZEN"]), metadata({ examples: ["ACTIVE", "DELETED", "FROZEN"] })),
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
      picklist([BASE_PRODUCT_ID, PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID]),
      metadata({ examples: [BASE_PRODUCT_ID, PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID] }),
    ),
  }),
);
