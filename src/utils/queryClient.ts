import AsyncStorage from "@react-native-async-storage/async-storage";

import { sdk } from "@farcaster/miniapp-sdk";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { persistQueryClientRestore, persistQueryClientSubscribe } from "@tanstack/query-persist-client-core";
import { dehydrate, QueryCache, QueryClient, type Query } from "@tanstack/react-query";
import { deserialize, serialize } from "wagmi";
import { hashFn, structuralSharing } from "wagmi/query";

import reportError from "./reportError";
import { isAvailable as isOwnerAvailable } from "./wagmi/owner";
import release from "../generated/release";

import type { getActivity } from "./server";
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import type { Address } from "viem";

const INVALIDATE_ON_UPGRADE = new Set(["kyc"]);

function versionAwareDeserialize(cache: string): PersistedClient {
  const persistedClient: PersistedClient = deserialize(cache);
  if (persistedClient.buster === release) return persistedClient;
  persistedClient.clientState.queries = persistedClient.clientState.queries.filter(
    (query) => !INVALIDATE_ON_UPGRADE.has(query.queryKey[0] as string),
  );
  persistedClient.buster = release;
  return persistedClient;
}

export const persister = createAsyncStoragePersister({
  serialize,
  deserialize: versionAwareDeserialize,
  storage: AsyncStorage,
  throttleTime: 0,
});
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.suppressError?.(error)) return;
      if (error instanceof Error && error.message === "don't refetch") return;
      if (error instanceof APIError) {
        if (error.code === 401 && error.text === "unauthorized") return;
        if (query.queryKey[0] === "card" && query.queryKey[1] === "details") {
          if (error.text === "kyc required") return;
          if (error.text === "bad kyc") return;
        }
      }
      reportError(error);
    },
  }),
  defaultOptions: { queries: { queryKeyHashFn: hashFn, structuralSharing } },
});

export const hydrated =
  typeof window === "undefined"
    ? Promise.resolve()
    : persistQueryClientRestore({ queryClient, persister, maxAge: 30 * 24 * 60 * 60_000, buster: release }).catch(
        (error: unknown) => {
          reportError(error);
          throw error;
        },
      );

const dehydrateOptions = {
  shouldDehydrateQuery: ({ queryKey, state }: Query) =>
    state.status === "success" && queryKey[0] !== "activity" && queryKey[0] !== "externalAssets",
};

if (typeof window !== "undefined") {
  const subscribe = () => persistQueryClientSubscribe({ queryClient, persister, dehydrateOptions, buster: release });
  hydrated.then(subscribe, subscribe);
}

export function persist() {
  return Promise.resolve(
    persister.persistClient({
      timestamp: Date.now(),
      buster: release,
      clientState: dehydrate(queryClient, dehydrateOptions),
    }),
  );
}

queryClient.setQueryDefaults(["credential"], {
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => {
    throw new Error("don't refetch");
  },
});
queryClient.setQueryDefaults(["settings", "sensitive"], {
  initialData: false,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["settings", "sensitive"]),
});
queryClient.setQueryDefaults(["settings", "alertShown"], {
  initialData: true,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["settings", "alertShown"]),
});
queryClient.setQueryDefaults(["settings", "installments"], {
  initialData: 1,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["settings", "installments"]),
});
queryClient.setQueryDefaults(["simulate-purchase", "installments"], {
  initialData: 1,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["simulate-purchase", "installments"]),
});
queryClient.setQueryDefaults(["contacts", "saved"], {
  initialData: undefined,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => {
    throw new Error("don't refetch");
  },
});
queryClient.setQueryDefaults(["contacts", "recent"], {
  initialData: undefined,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => {
    throw new Error("don't refetch");
  },
});
queryClient.setQueryDefaults(["loan"], {
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => {
    throw new Error("don't refetch");
  },
});
queryClient.setQueryDefaults(["activity", "details"], {
  queryFn: () => {
    throw new Error("don't refetch");
  },
});
queryClient.setQueryDefaults(["card-upgrade"], {
  initialData: undefined,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => {
    throw new Error("don't refetch");
  },
});
queryClient.setQueryDefaults(["card-details-open"], {
  initialData: false,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["card-details-open"]),
});
queryClient.setQueryDefaults(["user", "country"], {
  initialData: null,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["user", "country"]),
});
queryClient.setQueryDefaults(["settings", "rollover-intro-shown"], {
  initialData: false,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["settings", "rollover-intro-shown"]),
});
queryClient.setQueryDefaults(["settings", "explore-defi-shown"], {
  initialData: true,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["settings", "explore-defi-shown"]),
});
queryClient.setQueryDefaults(["settings", "defi-intro-shown"], {
  initialData: false,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["settings", "defi-intro-shown"]),
});
queryClient.setQueryDefaults(["defi", "usdc-funding-connected"], {
  initialData: false,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["defi", "usdc-funding-connected"]),
});

queryClient.setQueryDefaults(["defi", "lifi-connected"], {
  initialData: false,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["defi", "lifi-connected"]),
});
queryClient.setQueryDefaults(["manual-repayment-acknowledged"], {
  initialData: false,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => queryClient.getQueryData(["manual-repayment-acknowledged"]),
});
queryClient.setQueryDefaults<AuthMethod>(["method"], {
  initialData: undefined,
  retry: false,
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => {
    throw new Error("don't refetch");
  },
});
queryClient.setQueryDefaults(["is-owner-available"], {
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: isOwnerAvailable,
});
queryClient.setQueryDefaults(["is-miniapp"], {
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: async () => {
    return await sdk.isInMiniApp();
  },
});
queryClient.setQueryDefaults<EmbeddingContext>(["embedding-context"], {
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: async () => {
    if (process.env.EXPO_PUBLIC_ENV === "e2e") return "e2e";
    if (await sdk.isInMiniApp()) {
      const { client } = await sdk.context;
      switch (client.clientFid) {
        case 9152:
          switch (client.platformType) {
            case "web":
              return "farcaster-web" as const;
            default:
              return "farcaster" as const;
          }
        case 309_857:
          return "base" as const;
        default:
          return "unknown" as const;
      }
    }
    if (navigator.userAgent?.includes("MetaMask")) return "metamask" as const; // eslint-disable-line @typescript-eslint/no-unnecessary-condition
    if (navigator.userAgent?.includes("Phantom")) return "phantom" as const; // eslint-disable-line @typescript-eslint/no-unnecessary-condition
    return null;
  },
});
queryClient.setQueryDefaults(["kyc", "status"], { staleTime: 5 * 60_000, gcTime: 60 * 60_000 });

export type AuthMethod = "siwe" | "webauthn";
export type EmbeddingContext =
  | "base"
  | "e2e"
  | "farcaster"
  | "farcaster-web"
  | "metamask"
  | "phantom"
  | "unknown"
  | null;
export type ActivityItem = Awaited<ReturnType<typeof getActivity>>[number];

export type Loan = {
  amount?: bigint;
  installments?: number;
  market?: Address;
  maturity?: bigint;
  receiver?: Address;
};

export default queryClient;

export class APIError extends Error {
  code: number;
  text: string;
  constructor(code: number, text: string) {
    super(`${code} ${text}`);
    this.code = code;
    this.text = text;
    this.name = "APIError";
  }
}

declare module "@tanstack/react-query" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- module augmentation requires interface merging
  interface Register {
    queryMeta: { suppressError?: (error: unknown) => boolean | undefined };
  }
}
