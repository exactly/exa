import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useFocusEffect } from "expo-router";

import { useQuery } from "@tanstack/react-query";

import queryClient from "./queryClient";
import useAccount from "./useAccount";

import type { ActivityItem } from "./queryClient";

export default function useAnnouncement(id: Announcement, eligible: boolean) {
  const { address } = useAccount();
  const { data: seen } = useQuery<Seen>({
    queryKey: ["settings", "seen", address],
    queryFn: migrate,
    enabled: !!address,
  });
  const { data: activity, isSuccess } = useQuery<ActivityItem[]>({ queryKey: ["activity"], staleTime: Infinity });
  useSyncExternalStore(subscribe, () => version);
  useFocusEffect(
    useCallback(() => {
      if (!eligible) return;
      claims.add(id);
      emit();
      return () => {
        claims.delete(id);
        if (active === id) active = undefined;
        emit();
      };
    }, [id, eligible]),
  );
  const winner = seen && isSuccess ? pick(seen, activity) : undefined;
  useEffect(() => {
    if (winner !== id || active === id) return;
    active = id;
    if (!registry[id]?.contextual) shown = id;
    emit();
  }, [winner, id]);
  return [
    active === id,
    () => {
      if (!address) return;
      queryClient.setQueryData<Seen>(["settings", "seen", address], (previous) => ({ ...previous, [id]: Date.now() }));
      if (active === id) active = undefined;
      emit();
    },
  ] as const;
}

const announcements = {
  "installments-spotlight": { legacy: "installments-spotlight", contextual: true },
  "stocks-intro": { legacy: "stocks-intro-shown", since: "2026-09-29" },
  "advanced-intro": { legacy: "advanced-intro", contextual: true },
  "advanced-spotlight": { legacy: "advanced-spotlight", after: "advanced-intro", contextual: true },
} satisfies Record<string, Entry>;
const registry: Record<string, Entry | undefined> = announcements;

export function hold() {
  holds += 1;
  emit();
  return () => {
    holds -= 1;
    emit();
  };
}

const COOLDOWN = 24 * 60 * 60_000;
const FAMILIAR = 30 * 24 * 60 * 60_000;

const claims = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let holds = 0;
let active: Announcement | undefined;
let shown: Announcement | undefined;

function pick(seen: Seen, activity?: ActivityItem[]) {
  if (active) return active;
  if (holds > 0) return;
  const now = Date.now();
  const cooling =
    now < Math.max(0, ...Object.entries(seen).flatMap(([id, at]) => (registry[id]?.contextual ? [] : [at]))) + COOLDOWN;
  const oldest = Math.min(now, ...(activity ?? []).map(({ timestamp }) => Date.parse(timestamp)));
  return Object.entries<Entry>(announcements).find(
    ([id, { after, contextual, since, until }]) =>
      claims.has(id) &&
      (contextual === true || (!cooling && (!shown || shown === id))) &&
      !(id in seen) &&
      (!after || after in seen) &&
      (!until || now < Date.parse(until)) &&
      oldest >= (since ? Date.parse(since) : now - FAMILIAR),
  )?.[0] as Announcement | undefined;
}

function migrate(): Seen {
  return Object.fromEntries(
    Object.entries<Entry>(announcements).flatMap(([id, { legacy }]) =>
      legacy && queryClient.getQueryData<boolean>(["settings", legacy]) ? [[id, 0]] : [],
    ),
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

export type Announcement = keyof typeof announcements;
type Entry = { after?: string; contextual?: boolean; legacy?: string; since?: string; until?: string };
type Seen = Record<string, number>;
