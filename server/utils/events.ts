import { captureException } from "@sentry/node";
import { picklist, safeParse } from "valibot";

import { Address } from "@exactly/common/validation";

import watch from "./listen";

import type { Pool } from "pg";

const Kind = picklist(["activity", "card", "kyc", "proposals", "ramp"]);
export type Kind = (typeof Kind.options)[number];

const channel = "events";
const listeners = new Map<Address, Set<(kind: Kind) => unknown>>();
const closers = new Set<() => void>();
let closed = false;
let publish = deliver;

export function emit(account: Address, kind: Kind) {
  publish(`${kind}:${account}`);
}

export function publisher<Database extends { $client: Pool }>(database: Database) {
  publish = (message) => {
    database.$client
      .query("select pg_notify($1, $2)", [channel, message])
      .catch((error: unknown) => captureException(error, { level: "error" }));
  };
  return database;
}

export function listen(pool: Pool) {
  return watch(
    pool,
    (payload) => {
      if (payload === undefined) endAll();
      else deliver(payload);
      return Promise.resolve();
    },
    { channel },
    channel,
  );
}

export function subscribe(account: Address, listener: (kind: Kind) => unknown, end: () => void) {
  if (closed) return;
  const current = listeners.get(account) ?? new Set();
  listeners.set(account, current.add(listener));
  closers.add(end);
  return () => {
    current.delete(listener);
    if (current.size === 0 && listeners.get(account) === current) listeners.delete(account);
    closers.delete(end);
  };
}

export function close() {
  closed = true;
  endAll();
}

function endAll() {
  for (const stop of closers) stop();
}

function deliver(message: string) {
  const separator = message.indexOf(":");
  const kind = safeParse(Kind, message.slice(0, separator));
  const account = safeParse(Address, message.slice(separator + 1));
  if (!kind.success || !account.success) return;
  for (const listener of listeners.get(account.output) ?? []) listener(kind.output);
}
