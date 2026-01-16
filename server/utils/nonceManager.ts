import { startSpan } from "@sentry/node";
import { getTransactionCount } from "viem/actions";

import type { Address, CreateNonceManagerParameters, NonceManager } from "viem";

class LruMap<value = unknown> extends Map<string, value> {
  maxSize: number;
  constructor(size: number) {
    super();
    this.maxSize = size;
  }
  override get(key: string) {
    const value = super.get(key);
    if (super.has(key) && value !== undefined) {
      this.delete(key);
      super.set(key, value);
    }
    return value;
  }
  override set(key: string, value: value) {
    super.set(key, value);
    if (this.maxSize && this.size > this.maxSize) {
      const firstKey = this.keys().next().value;
      if (firstKey) this.delete(firstKey);
    }
    return this;
  }
}

export function createNonceManager({ source }: CreateNonceManagerParameters): NonceManager & {
  hardReset: (parameters: { address: Address; chainId: number }) => void;
  info: (parameters: { address: Address; chainId: number }) => { delta: number | undefined; nonce: number | undefined };
} {
  const deltaMap = new Map<string, number>();
  const nonceMap = new LruMap<number>(8192);
  const promiseMap = new Map<string, Promise<number>>();

  return {
    async consume({ address, chainId, client }) {
      return startSpan({ name: "consume nonce", op: "nonce.consume" }, async (span) => {
        const key = getKey({ address, chainId });
        span.setAttribute("exa.key", key);
        const promise = this.get({ address, chainId, client });

        this.increment({ address, chainId });
        const nonce = await promise;

        await source.set({ address, chainId }, nonce);
        nonceMap.set(key, nonce);
        span.setAttribute("exa.consume", nonce);
        return nonce;
      });
    },
    increment({ address, chainId }) {
      startSpan({ name: "increment nonce", op: "nonce.increment" }, (span) => {
        const key = getKey({ address, chainId });
        span.setAttribute("exa.key", key);
        span.setAttribute("exa.delta", deltaMap.get(key));
        const delta = deltaMap.get(key) ?? 0;
        deltaMap.set(key, delta + 1);
      });
    },
    async get({ address, chainId, client }) {
      return startSpan({ name: "get nonce", op: "nonce.get" }, async (span) => {
        const key = getKey({ address, chainId });
        span.setAttribute("exa.key", key);
        let promise = promiseMap.get(key);
        span.setAttribute("exa.promise", !!promise);
        if (!promise) {
          promise = (async () => {
            try {
              const nonce = await source.get({ address, chainId, client });
              const previousNonce = nonceMap.get(key) ?? 0;
              span.setAttribute("exa.get", nonce);
              span.setAttribute("exa.previousNonce", nonceMap.get(key));
              if (previousNonce > 0 && nonce <= previousNonce) {
                span.setAttribute("exa.internalNonce", previousNonce + 1);
                return previousNonce + 1;
              }
              nonceMap.delete(key);
              span.setAttribute("exa.delete", true);
              span.setAttribute("exa.nonce", nonce);
              return nonce;
            } finally {
              this.reset({ address, chainId });
            }
          })();
          promiseMap.set(key, promise);
        }
        span.setAttribute("exa.delta", deltaMap.get(key));
        const delta = deltaMap.get(key) ?? 0;
        return delta + (await promise);
      });
    },
    reset({ address, chainId }) {
      startSpan({ name: "reset nonce", op: "nonce.reset" }, (span) => {
        const key = getKey({ address, chainId });
        span.setAttribute("exa.key", key);
        span.setAttribute("exa.delta", deltaMap.get(key));
        span.setAttribute("exa.promise", !!promiseMap.get(key));
        deltaMap.delete(key);
        promiseMap.delete(key);
      });
    },
    hardReset({ address, chainId }) {
      startSpan({ name: "hard reset", op: "nonce.hard" }, (span) => {
        const key = getKey({ address, chainId });
        span.setAttribute("exa.key", key);
        span.setAttribute("exa.delta", deltaMap.get(key));
        span.setAttribute("exa.promise", !!promiseMap.get(key));
        span.setAttribute("exa.nonce", nonceMap.get(key));
        deltaMap.delete(key);
        promiseMap.delete(key);
        nonceMap.delete(key);
      });
    },
    info({ address, chainId }) {
      const key = getKey({ address, chainId });
      return { delta: deltaMap.get(key), nonce: nonceMap.get(key) };
    },
  };
}

export default createNonceManager({
  source: {
    get: async ({ address, client }) => getTransactionCount(client, { address, blockTag: "pending" }),
    set: () => undefined,
  },
});

const getKey = ({ address, chainId }: { address: Address; chainId: number }) => `${address}.${chainId}`;
