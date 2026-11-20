import { useEffect } from "react";
import { AppState } from "react-native";

import { hashKey } from "@tanstack/react-query";

import queryClient, { isServer } from "./queryClient";
import reportError from "./reportError";
import { apiURL, authenticated } from "./server";

import type { Kind } from "@exactly/server/api/events";

const onchain = [
  ["balance"],
  ["deployed"],
  ["getBytecode"],
  ["network"],
  ["readContract"],
  ["readContracts"],
  ["simulateBlocks"],
  ["lifi", "balances"],
];
const targets: Record<Kind, readonly (readonly string[])[]> = {
  activity: [["activity"], ...onchain],
  card: [["activity"], ["card", "details"], ["kyc", "cardLimit"], ...onchain],
  kyc: [
    ["card", "details"],
    ["kyc", "cardLimit"],
    ["kyc", "panda-business"],
    ["kyc", "status"],
    ["ramp", "providers"],
  ],
  proposals: [["activity"], ["proposal"], ["proposals"], ...onchain],
  ramp: [["activity"], ["ramp", "providers"]],
};
const everything = [...new Set(Object.values(targets).flat())];
const authHash = hashKey(["auth"]);

export default function useEvents() {
  useEffect(() => (isServer ? undefined : listen()), []);
}

function listen() {
  let request: undefined | XMLHttpRequest;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let rejected: unknown;

  const appState = AppState.addEventListener("change", update);
  const unsubscribe = queryClient.getQueryCache().subscribe(({ query: { queryHash } }) => {
    if (queryHash === authHash) update();
  });
  update();
  return () => {
    appState.remove();
    unsubscribe();
    disconnect();
  };

  function update() {
    if (AppState.currentState !== "background" && authenticated() && queryClient.getQueryData(["auth"]) !== rejected) {
      if (!request && retry === undefined) connect();
    } else {
      disconnect();
    }
  }

  function connect() {
    const current = new XMLHttpRequest();
    let offset = 0;
    let buffer = "";
    request = current;
    current.addEventListener("progress", () => {
      buffer += current.responseText.slice(offset);
      offset = current.responseText.length;
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        if (event === "ready") {
          attempts = 0;
          invalidate(everything);
        } else if (event && isKind(event)) {
          invalidate(targets[event]);
        }
      }
    });
    current.addEventListener("loadend", () => {
      if (request !== current) return;
      request = undefined;
      if (current.status === 401) {
        rejected = queryClient.getQueryData(["auth"]);
        return;
      }
      retry = setTimeout(
        () => {
          retry = undefined;
          update();
        },
        Math.min(1000 * 2 ** attempts++, 30_000),
      );
    });
    current.open("GET", `${apiURL}/events`);
    current.withCredentials = true;
    current.send();
  }

  function disconnect() {
    clearTimeout(retry);
    retry = undefined;
    const current = request;
    request = undefined;
    current?.abort();
  }
}

function isKind(event: string): event is Kind {
  return Object.hasOwn(targets, event);
}

function invalidate(prefixes: readonly (readonly string[])[]) {
  queryClient
    .invalidateQueries({
      predicate: ({ queryKey, state }) =>
        !(queryKey[0] === "deployed" && state.data === true) &&
        prefixes.some((prefix) => prefix.every((part, index) => queryKey[index] === part)),
    })
    .catch(reportError);
}
