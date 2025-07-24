/* eslint-disable no-console */
import * as Opensearch from "@opensearch-project/opensearch";
import * as v from "valibot";

process.env.ISSUER_PRIVATE_KEY = "";
process.env.KEEPER_PRIVATE_KEY = "";
process.env.POSTGRES_URL = "";
process.env.PANDA_API_KEY = "";
process.env.PANDA_API_URL = "";
process.env.SEGMENT_WRITE_KEY = "";
process.env.OPENSEARCH_URL = "";

// For range "2025-01-01T00:00:00.000Z" to "2025-07-08T19:20:00.000Z" we use authorizedAt 2025-07-28T17:19:25.658Z in combination with event.id to generate a timestamp because
// the issue checker only accepts a timestamp upto 2 month old.

import("../hooks/panda")
  .then(async ({ default: api }) => {
    if (!process.env.OPENSEARCH_URL) throw new Error("OPENSEARCH_URL is not set");
    const options: Opensearch.ClientOptions = { node: process.env.OPENSEARCH_URL, ssl: { rejectUnauthorized: false } };
    const client = new Opensearch.Client(options);

    const search: Opensearch.API.Search_RequestBody = {
      query: {
        bool: {
          filter: [
            {
              bool: {
                filter: [
                  {
                    multi_match: {
                      type: "phrase",
                      query: "transaction",
                      lenient: true,
                    },
                  },
                  {
                    multi_match: {
                      type: "phrase",
                      query: "completed",
                      lenient: true,
                    },
                  },
                ],
              },
            },
            {
              range: {
                "@timestamp": {
                  // original whole range
                  gte: "2025-01-01T00:00:00.000Z",
                  lte: "2025-07-08T19:20:00.000Z",
                  format: "strict_date_optional_time",
                },
              },
            },
          ],
        },
      },
      sort: [
        {
          "@timestamp": {
            order: "asc",
          },
        },
      ],
    } as const;

    const skip = new Set([
      "683c635c-35c3-43c3-b397-e4240abc23a9",
      "9b39ef4e-878f-459e-9d59-e52f9925c434",
      "118ca441-65c2-4d45-9ef6-9a600aea0418",
      "e9ddad83-c6ca-47b8-8410-729d24e4380e",
      "a18370dd-8c46-4ab8-923a-bbbab3289904",
      "efd7d2bf-907d-4dd1-97af-6c9714fff8bb",
      "a9c30c4e-3ac1-4b7d-a3c8-1145271beea1",
      "35c346db-696c-46dc-bf27-0181f96dd492",
      "3f9e1d7-de59-4b4b-9fca-bf806cddff6d",
      "c7a2eba1-8859-429c-86f8-0faed13c2834",
      "fd392983-bda6-4aad-ae6f-a07ff1cb0191",
      "acbaa12c-5023-423c-bf6b-cda7bc43b6a0",
      "362ce562-624a-4430-ac96-9a4112a69e74",
      "631e2b1a-a1f6-4bd2-b262-4581d3576cd0",
      "fcce7f2d-d1d3-4687-9a35-cb973a41d0c9",
      "75176129-0c95-4b65-80f6-63773978a6ea",
      "120464ed-2db6-477c-a6ca-4c8e7d21b17b",
      "c34464e1-76aa-4c03-bb7d-565321f2cf5c",
      "789863ba-0cd3-4c78-af98-ce706b158aa8",
      "f768210f-46e7-4e4e-9a0f-c19211cb0016",
    ]);

    let searchAfter: Opensearch.API.Search_RequestBody["search_after"] | undefined;
    let pageCount = 0;
    const maxPages = 100_000;
    let total = 0;
    let collects = 0;
    let refunds = 0;

    while (pageCount < maxPages) {
      try {
        const response = await client.search({
          index: "logs",
          size: 50,
          body: {
            ...search,
            ...(searchAfter && { search_after: searchAfter }),
          },
        });

        const hits = response.body.hits.hits;

        if (hits.length === 0) break;

        await Promise.allSettled(
          hits.map(async (hit) => {
            const source = v.parse(v.object({ "@timestamp": v.string(), log: v.string() }), hit._source);
            const payload = v.parse(Payload, JSON.parse(source.log.slice(Math.max(0, source.log.indexOf("{")))));
            if (
              payload.resource === "transaction" &&
              payload.action === "completed" &&
              payload.body.spend.amount >= 0
            ) {
              const capture = payload.body.spend.amount - (payload.body.spend.authorizedAmount ?? 0);

              if (skip.has(payload.body.id)) {
                console.log(
                  `opensearch,${source["@timestamp"]} event: ${payload.id},${payload.body.id},${payload.resource},${payload.action},capture,${capture},status, SKIP`,
                );
                return;
              }
              if (capture > 0) {
                collects += capture;
              } else {
                refunds += capture;
              }
              const pandaResponse = await api.request("/", {
                method: "POST",
                body: JSON.stringify(payload),
                headers: new Headers({ "Content-Type": "application/json", Signature: "123" }),
              });
              console.log(
                `opensearch,${source["@timestamp"]} event: ${payload.id},${payload.body.id},${payload.resource},${payload.action},capture,${capture},status,${pandaResponse.status}`,
              );
            }
          }),
        );
        searchAfter = hits.at(-1)?.sort;
        pageCount++;
        total += hits.length;
      } catch (error) {
        console.error(error);
        break;
      }
    }
    console.log(`Total documents: ${total}, collects: ${collects / 100}, refunds: ${refunds / 100}`);
  })
  .catch((error: unknown) => {
    console.error(error);
  });

const BaseTransaction = v.object({
  id: v.string(),
  type: v.literal("spend"),
  spend: v.object({
    amount: v.number(),
    currency: v.literal("usd"),
    cardId: v.string(),
    cardType: v.literal("virtual"),
    localAmount: v.number(),
    localCurrency: v.pipe(v.string(), v.length(3)),
    merchantCity: v.nullish(v.string()),
    merchantCountry: v.nullish(v.string()),
    merchantCategory: v.nullish(v.string()),
    merchantName: v.string(),
    authorizedAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
    authorizedAmount: v.nullish(v.number()),
  }),
});

const Transaction = v.variant("action", [
  v.object({
    id: v.string(),
    resource: v.literal("transaction"),
    action: v.literal("created"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        status: v.picklist(["pending", "declined"]),
        declinedReason: v.nullish(v.string()),
      }),
    }),
  }),
  v.object({
    id: v.string(),
    resource: v.literal("transaction"),
    action: v.literal("updated"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        authorizationUpdateAmount: v.number(),
        authorizedAt: v.pipe(v.string(), v.isoTimestamp()),
        status: v.picklist(["declined", "pending", "reversed"]),
        declinedReason: v.nullish(v.string()),
      }),
    }),
  }),
  v.object({
    id: v.string(),
    resource: v.literal("transaction"),
    action: v.literal("requested"),
    body: v.object({
      ...BaseTransaction.entries,
      id: v.optional(v.string()),
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        authorizedAmount: v.number(),
        status: v.literal("pending"),
      }),
    }),
  }),
  v.object({
    id: v.string(),
    resource: v.literal("transaction"),
    action: v.literal("completed"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        authorizedAt: v.pipe(v.string(), v.isoTimestamp()),
        postedAt: v.pipe(v.string(), v.isoTimestamp()),
        status: v.literal("completed"),
      }),
    }),
  }),
]);

const Payload = v.variant("resource", [
  Transaction,
  v.object({
    id: v.string(),
    resource: v.literal("card"),
    action: v.literal("updated"),
    body: v.object({
      expirationMonth: v.pipe(v.string(), v.minLength(1), v.maxLength(2)),
      expirationYear: v.pipe(v.string(), v.length(4)),
      id: v.string(),
      last4: v.pipe(v.string(), v.length(4)),
      limit: v.object({
        amount: v.number(),
        frequency: v.picklist([
          "per24HourPeriod",
          "per7DayPeriod",
          "per30DayPeriod",
          "perYearPeriod",
          "allTime",
          "perAuthorization",
        ]),
      }),
      status: v.picklist(["notActivated", "active", "locked", "canceled"]),
      tokenWallets: v.union([v.array(v.literal("Apple")), v.array(v.literal("Google Pay"))]),
      type: v.literal("virtual"),
      userId: v.string(),
    }),
  }),
  v.object({
    resource: v.literal("user"),
    action: v.literal("updated"),
    body: v.object({
      applicationReason: v.string(),
      applicationStatus: v.string(),
      firstName: v.string(),
      id: v.string(),
      isActive: v.boolean(),
      isTermsOfServiceAccepted: v.boolean(),
      lastName: v.string(),
    }),
    id: v.string(),
  }),
]);
