import { sdk } from "@farcaster/miniapp-sdk";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { persistQueryClientRestore, persistQueryClientSubscribe } from "@tanstack/query-persist-client-core";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { deserialize, serialize } from "wagmi";
import { hashFn, structuralSharing } from "wagmi/query";

import reportError from "./reportError";
import type { getActivity } from "./server";
import { isAvailable as isOwnerAvailable } from "./wagmi/owner";

export const persister = createAsyncStoragePersister({ serialize, deserialize, storage: AsyncStorage });
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.suppressError?.(error)) return;
      if (error instanceof Error && error.message === "don't refetch") return;
      if (error instanceof APIError) {
        if (error.code === 401 && error.text === "unauthorized") return;
        if (query.queryKey[0] === "card" && query.queryKey[1] === "details") {
          if (error.text === "card not found") return;
          if (error.text === "kyc required") return;
          if (error.text === "kyc not approved") return;
        }
      }
      reportError(error);
    },
  }),
  defaultOptions: { queries: { queryKeyHashFn: hashFn, structuralSharing } },
});

if (typeof window !== "undefined") {
  persistQueryClientRestore({ queryClient, persister, maxAge: Infinity }).catch(reportError);
  persistQueryClientSubscribe({ queryClient, persister });
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
queryClient.setQueryDefaults(["withdrawal"], {
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

export type AuthMethod = "siwe" | "webauthn";
export type EmbeddingContext = "base" | "farcaster" | "farcaster-web" | "metamask" | "phantom" | "unknown" | null;
export type ActivityItem = Awaited<ReturnType<typeof getActivity>>[number];
export interface Withdraw {
  market?: Address;
  amount: bigint;
  receiver?: Address;
}

export interface Loan {
  market?: Address;
  amount?: bigint;
  installments?: number;
  maturity?: bigint;
  receiver?: Address;
}

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
  interface Register {
    queryMeta: { suppressError?: (error: unknown) => boolean | undefined };
  }
}
