import { useEffect, useRef } from "react";

import reportError from "./reportError";

type TabName = "activity" | "card" | "defi" | "index" | "pay-mode";

const subscribers = new Map<TabName, Set<() => void>>();

export default function useTabPress(name: TabName, onPress: () => void) {
  const handlerRef = useRef(onPress);
  handlerRef.current = onPress;

  useEffect(() => {
    const handler: () => void = () => handlerRef.current();
    let handlers = subscribers.get(name);
    if (!handlers) {
      handlers = new Set();
      subscribers.set(name, handlers);
    }
    handlers.add(handler);
    return () => {
      subscribers.get(name)?.delete(handler);
    };
  }, [name]);
}

export function emitTabPress(name: TabName) {
  const handlers = subscribers.get(name);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler();
      } catch (error) {
        reportError(error);
      }
    }
  }
}
