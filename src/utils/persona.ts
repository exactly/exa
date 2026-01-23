import { Platform } from "react-native";
import type { Environment } from "react-native-persona";

import { router } from "expo-router";

import { sdk } from "@farcaster/miniapp-sdk";

import domain from "@exactly/common/domain";

import queryClient, { type EmbeddingContext } from "./queryClient";
import reportError from "./reportError";
import { getKYCTokens } from "./server";

export const environment = (__DEV__ || process.env.EXPO_PUBLIC_ENV === "e2e" ? "sandbox" : "production") as Environment;
let current: undefined | { controller: AbortController; promise: Promise<void> };

export function startKYC() {
  if (current && !current.controller.signal.aborted) return current.promise;

  current?.controller.abort(new Error("persona inquiry aborted"));
  const controller = new AbortController();

  const promise = (async () => {
    const { signal } = controller;

    if (Platform.OS === "web") {
      const onPageHide = () => controller.abort(new Error("page unloaded"));
      globalThis.addEventListener("pagehide", onPageHide);
      signal.addEventListener("abort", () => globalThis.removeEventListener("pagehide", onPageHide), { once: true });
    }

    if (Platform.OS === "web") {
      const [{ Client }, { inquiryId, sessionToken }] = await Promise.all([
        import("persona"),
        getKYCTokens("basic", await getRedirectURI()),
      ]);
      if (signal.aborted) throw signal.reason;

      return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          client.destroy();
          reject(new Error("persona inquiry aborted", { cause: signal.reason }));
        };
        const client = new Client({
          inquiryId,
          sessionToken,
          environment: environment as "production" | "sandbox", // TODO implement environmentId
          onReady: () => client.open(),
          onComplete: () => {
            signal.removeEventListener("abort", onAbort);
            client.destroy();
            handleComplete();
            resolve();
          },
          onCancel: () => {
            signal.removeEventListener("abort", onAbort);
            client.destroy();
            handleCancel();
            resolve();
          },
          onError: (error) => {
            signal.removeEventListener("abort", onAbort);
            client.destroy();
            reportError(error);
            reject(new Error("persona inquiry failed", { cause: error }));
          },
        });
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }

    const { inquiryId, sessionToken } = await getKYCTokens("basic", await getRedirectURI());
    if (signal.aborted) throw signal.reason;

    const { Inquiry } = await import("react-native-persona");
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new Error("persona inquiry aborted", { cause: signal.reason }));
      signal.addEventListener("abort", onAbort, { once: true });
      Inquiry.fromInquiry(inquiryId)
        .sessionToken(sessionToken)
        .onCanceled(() => {
          signal.removeEventListener("abort", onAbort);
          handleCancel();
          resolve();
        })
        .onComplete(() => {
          signal.removeEventListener("abort", onAbort);
          handleComplete();
          resolve();
        })
        .onError((error) => {
          signal.removeEventListener("abort", onAbort);
          reportError(error);
          reject(error);
        })
        .build()
        .start();
    });
  })().finally(() => {
    if (current?.controller === controller) current = undefined;
  });

  current = { controller, promise };
  return promise;
}

export function cancelKYC() {
  current?.controller.abort(new Error("persona inquiry cancelled"));
}

async function getRedirectURI() {
  if (Platform.OS === "web" && (await sdk.isInMiniApp())) {
    const { client } = await sdk.context;
    if ("appUrl" in client && typeof client.appUrl === "string") return client.appUrl;
  }
  switch (queryClient.getQueryData<EmbeddingContext>(["embedding-context"])) {
    case "farcaster-web":
      return `https://farcaster.xyz/miniapps/${
        {
          "web.exactly.app": "410vYppvUo1p", // cspell:ignore 410vYppvUo1p
          "sandbox.exactly.app": "nsbPHUIBynR4", // cspell:ignore nsbPHUIBynR4
        }[domain]
      }/exa-app`;
  }
}

function handleComplete() {
  queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
  queryClient.setQueryData(["card-upgrade"], 1);
  router.replace("/(main)/(home)");
}

function handleCancel() {
  queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
  router.replace("/(main)/(home)");
}
