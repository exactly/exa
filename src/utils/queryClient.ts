import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { persistQueryClientRestore, persistQueryClientSubscribe } from "@tanstack/query-persist-client-core";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { deserialize, serialize } from "wagmi";
import { structuralSharing } from "wagmi/query";

import reportError from "./reportError";
import type { getActivity } from "./server";

export const persister = createAsyncStoragePersister({ serialize, deserialize, storage: AsyncStorage });
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof Error && error.message === "don't refetch") return;
      if (error instanceof APIError) {
        if (query.queryKey[0] === "card" && query.queryKey[1] === "details") {
          if (error.text === "card not found") return;
          if (error.text === "kyc required") return;
          if (error.text === "kyc not approved") return;
        }
        if (query.queryKey[0] === "kyc" && query.queryKey[1] === "status") {
          if (error.text === "kyc not found") return;
          if (error.text === "kyc not started") return;
          if (error.text === "kyc not approved") return;
        }
      }
      reportError(error);
    },
  }),
  defaultOptions: { queries: { structuralSharing } },
});

if (typeof window !== "undefined") {
  persistQueryClientRestore({ queryClient, persister, maxAge: Infinity }).catch(reportError);
  persistQueryClientSubscribe({ queryClient, persister });
}

queryClient.setQueryDefaults(["passkey"], {
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

export type ActivityItem = Awaited<ReturnType<typeof getActivity>>[number];
export interface Withdraw {
  receiver?: Address;
  market?: Address;
  amount: bigint;
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
