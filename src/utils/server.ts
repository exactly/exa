import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import { Credential } from "@exactly/common/validation";
import type { ExaAPI } from "@exactly/server/api";
import { sdk } from "@farcaster/miniapp-sdk";
import { getAccount, signMessage } from "@wagmi/core";
import { hc } from "hono/client";
import { Platform } from "react-native";
import { get as assert, create } from "react-native-passkeys";
import { check, number, parse, pipe, safeParse, ValiError } from "valibot";

import { decrypt, decryptPIN, encryptPIN, session } from "./panda";
import queryClient, { APIError, type AuthMethod } from "./queryClient";
import ownerConfig from "./wagmi/owner";

queryClient.setQueryDefaults<number | undefined>(["auth"], {
  retry: false,
  enabled: false,
  staleTime: AUTH_EXPIRY,
  gcTime: AUTH_EXPIRY,
  queryFn: async () => {
    const method = queryClient.getQueryData<AuthMethod>(["method"]);
    const credentialId =
      method === "siwe"
        ? getAccount(ownerConfig).address
        : queryClient.getQueryData<Credential>(["credential"])?.credentialId;
    if (method === "siwe" && !credentialId) return queryClient.getQueryData<number>(["auth"]) ?? 0;
    const get = await api.auth.authentication.$get({ query: { credentialId } });
    const options = await get.json();
    if (options.method === "webauthn" && Platform.OS === "android") delete options.allowCredentials; // HACK fix android credential filtering
    const json =
      options.method === "siwe"
        ? {
            method: "siwe" as const,
            id: options.address,
            signature: await signMessage(ownerConfig, { account: options.address, message: options.message }),
          }
        : await assert({
            ...options,
            allowCredentials: Platform.OS === "android" ? undefined : options.allowCredentials, // HACK fix android credential filtering
            extensions: options.extensions as Record<string, unknown> | undefined,
          }).then((assertion) => {
            if (!assertion) throw new Error("bad assertion");
            return { method: "webauthn" as const, ...assertion };
          });
    const post = await api.auth.authentication.$post({ json });
    if (!post.ok) throw new APIError(post.status, stringOrLegacy(await post.json()));
    const { expires, intercomToken } = await post.json();
    queryClient.setQueryData(["intercom", "jwt"], intercomToken);
    return parse(Auth, expires);
  },
  meta: {
    suppressError: (error) => {
      if (error instanceof ValiError) return true;
      if (
        error instanceof Error &&
        (error.name === "NotAllowedError" ||
          error.message ===
            "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" ||
          error.message === "The operation couldn’t be completed. Device must be unlocked to perform request." ||
          error.message === "UserCancelled" ||
          error.message.startsWith("androidx.credentials.exceptions.domerrors.NotAllowedError"))
      ) {
        return true;
      }
      return false;
    },
  },
});

const api = hc<ExaAPI>(domain === "localhost" ? "http://localhost:3000/api" : `https://${domain}/api`, {
  init: { credentials: "include" },
  fetch: async (input: string | Request | URL, init?: RequestInit) => {
    if (!(await sdk.isInMiniApp())) return fetch(input, init);
    const { client } = await sdk.context;
    const headers = new Headers(init?.headers);
    headers.set("Client-Fid", String(client.clientFid));
    return fetch(input, { ...init, headers });
  },
});

async function getCard() {
  await auth();
  const { id, secret } = await session();
  const response = await api.card.$get({ header: { sessionid: id } });
  if (!response.ok) {
    const { code } = await response.json();
    if (response.status !== 403 || code !== "no panda") throw new APIError(response.status, code);
    return null;
  }
  const card = await response.json();
  return { ...card, secret };
}
queryClient.setQueryDefaults(["card", "details"], { queryFn: getCard });
export type CardDetails = Awaited<ReturnType<typeof getCard>>;

async function getPIN() {
  const result = await getCard();
  if (!result) return null;
  const { secret, encryptedPan, encryptedCvc, pin } = result;
  const [pan, cvc, decryptedPIN] = await Promise.all([
    decrypt(encryptedPan.data, encryptedPan.iv, secret),
    decrypt(encryptedCvc.data, encryptedCvc.iv, secret),
    pin ? decryptPIN(pin.data, pin.iv, secret) : Promise.resolve(null),
  ]);
  if (!decryptedPIN) {
    const newPIN = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
    await setCardPIN(newPIN);
    return { ...result, details: { pan, cvc, pin: newPIN } };
  }
  return { ...result, details: { pan, cvc, pin: decryptedPIN } };
}
queryClient.setQueryDefaults(["card", "pin"], { queryFn: getPIN });
export type CardWithPIN = Awaited<ReturnType<typeof getPIN>>;

export async function createCard() {
  await auth();
  const response = await api.card.$post();
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function setCardStatus(status: "ACTIVE" | "FROZEN" | "DELETED") {
  await auth();
  const response = await api.card.$patch({ json: { status } });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function setCardMode(mode: number) {
  await auth();
  const response = await api.card.$patch({ json: { mode } });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function setCardPIN(pin: string) {
  await auth();
  const json = await encryptPIN(pin);
  const response = await api.card.$patch({ json });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
}

export async function getKYCLink(templateId: string, redirectURI?: string) {
  await auth();
  const response = await api.kyc.$post({ json: { templateId, redirectURI } });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return stringOrLegacy(await response.json());
}

export async function getKYCStatus(templateId: string) {
  await auth();
  const response = await api.kyc.$get({ query: { templateId } });
  queryClient.setQueryData(["user", "country"], response.headers.get("User-Country"));
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  const result = await response.json();
  return typeof result === "string" || "legacy" in result
    ? stringOrLegacy(result as string | { legacy: string })
    : result;
}

export async function getCredential() {
  await auth();
  const response = await api.passkey.$get();
  if (!response.ok) {
    if ((response.status as number) === 401) {
      queryClient.setQueryData(["auth"], undefined);
      return getCredential();
    }
    throw new APIError(response.status, stringOrLegacy(await response.json()));
  }
  return response.json();
}

export async function createCredential() {
  const method = queryClient.getQueryData<AuthMethod>(["method"]);
  const credentialId = method === "siwe" ? getAccount(ownerConfig).address : undefined;
  if (method === "siwe" && !credentialId) throw new Error("invalid operation");
  const get = await api.auth.registration.$get({ query: { credentialId } });
  const options = await get.json();
  const post = await api.auth.registration.$post({
    json:
      options.method === "siwe"
        ? {
            method: options.method,
            id: options.address,
            signature: await signMessage(ownerConfig, { account: options.address, message: options.message }),
          }
        : await create({
            ...options,
            extensions: options.extensions as Record<string, unknown> | undefined,
          }).then((attestation) => {
            if (!attestation) throw new Error("bad attestation");
            return attestation;
          }),
  });
  if (!post.ok) throw new APIError(post.status, stringOrLegacy(await post.json()));
  const { auth: expires, intercomToken, ...passkey } = await post.json();
  queryClient.setQueryData(["intercom", "jwt"], intercomToken);
  await queryClient.setQueryData(["auth"], parse(Auth, expires));
  return parse(Credential, passkey);
}

export async function getActivity(parameters?: NonNullable<Parameters<typeof api.activity.$get>[0]>["query"]) {
  await auth();
  const response = await api.activity.$get(
    parameters?.include === undefined ? undefined : { query: { include: parameters.include } },
  );
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function auth() {
  if (queryClient.isFetching({ queryKey: ["auth"] })) return;
  const { success, output } = safeParse(Auth, queryClient.getQueryData<number | undefined>(["auth"]));
  if (!success) {
    await (typeof output === "number"
      ? queryClient.refetchQueries({ queryKey: ["auth"] })
      : queryClient.fetchQuery({ queryKey: ["auth"] }));
  }
}

const Auth = pipe(
  number("no auth"),
  check((expires) => Date.now() < expires, "auth expired"),
);

export { APIError } from "./queryClient";

function stringOrLegacy(response: string | { legacy: string }) {
  if (typeof response === "string") return response;
  if ("legacy" in response && typeof response.legacy === "string") return response.legacy;
  throw new Error("invalid api response");
}
