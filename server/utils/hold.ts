import { and, eq, inArray } from "drizzle-orm";
import { parse } from "valibot";

import { Address } from "@exactly/common/validation";

import { cards, credentials } from "../database/schema";

import type createSegment from "./segment";
import type * as schema from "../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const holds = new Map<string, { pending: number; settled: number }>();

export function heldSince(credentialId: string, since: number) {
  const entry = holds.get(credentialId);
  return entry !== undefined && (entry.pending > 0 || entry.settled >= since);
}

export async function hold(
  { database, segment }: { database: NodePgDatabase<typeof schema>; segment: ReturnType<typeof createSegment> },
  credentialId: string,
) {
  const entry = holds.get(credentialId) ?? { pending: 0, settled: 0 };
  holds.set(credentialId, entry);
  entry.pending++;
  try {
    return await apply({ database, segment }, credentialId);
  } finally {
    entry.pending--;
    entry.settled = performance.now();
  }
}

async function apply(
  { database, segment }: { database: NodePgDatabase<typeof schema>; segment: ReturnType<typeof createSegment> },
  credentialId: string,
) {
  const credential = await database.query.credentials.findFirst({
    columns: { account: true, source: true },
    where: eq(credentials.id, credentialId),
  });
  if (!credential) return [];
  const held = await database
    .update(cards)
    .set({ status: "HELD" })
    .where(and(eq(cards.credentialId, credentialId), inArray(cards.status, ["ACTIVE", "FROZEN"])))
    .returning({ id: cards.id });
  if (held.length > 0) {
    segment.track({
      userId: parse(Address, credential.account),
      event: "CardHeld",
      properties: { source: credential.source },
    });
  }
  return held;
}

export function release(database: NodePgDatabase<typeof schema>, credentialIds: string[]) {
  return database
    .update(cards)
    .set({ status: "FROZEN" })
    .where(and(inArray(cards.credentialId, credentialIds), eq(cards.status, "HELD")))
    .returning({ id: cards.id });
}
