import { Platform } from "react-native";
import { get as assert, create } from "react-native-passkeys";

import { sdk } from "@farcaster/miniapp-sdk";
import { getConnection, signMessage } from "@wagmi/core";
import { hc, parseResponse, type InferResponseType } from "hono/client";
import { check, number, object, parse, pipe, safeParse, string, ValiError } from "valibot";
import { UserRejectedRequestError } from "viem";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import { Credential } from "@exactly/common/validation";

import { login as loginIntercom, logout as logoutIntercom } from "./intercom";
import { decrypt, decryptPIN, encryptPIN, session } from "./panda";
import queryClient, { APIError, type AuthMethod } from "./queryClient";
import { classifyError } from "./reportError";
import ownerConfig from "./wagmi/owner";

import type { ExaAPI } from "@exactly/server/api"; // eslint-disable-line @nx/enforce-module-boundaries

queryClient.setQueryDefaults<number | undefined>(["auth"], {
  retry: false,
  enabled: false,
  staleTime: AUTH_EXPIRY,
  gcTime: AUTH_EXPIRY,
  queryFn: async () => {
    const method = queryClient.getQueryData<AuthMethod>(["method"]);
    const owner =
      method === "siwe"
        ? getConnection(ownerConfig).address
        : queryClient.getQueryData<Credential>(["credential"])?.credentialId;
    if (method === "siwe" && !owner) return queryClient.getQueryData<number>(["auth"]) ?? 0;
    const get = await api.auth.authentication.$get({ query: { credentialId: owner } });
    const sessionId = get.headers.get("x-session-id");
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
    const post = await api.auth.authentication.$post(
      { json },
      sessionId ? { headers: { "x-session-id": sessionId } } : undefined,
    );
    if (!post.ok) throw new APIError(post.status, stringOrLegacy(await post.json()));
    const { expires, intercomToken, credentialId, factory, x, y } = await post.json();
    queryClient.setQueryData(["credential"], { credentialId, factory, x, y });
    await logoutIntercom();
    await loginIntercom(deriveAddress(factory, { x, y }), intercomToken);
    return parse(Auth, expires);
  },
  meta: {
    dropError: (error) => {
      if (error instanceof ValiError) return true;
      if (error instanceof UserRejectedRequestError) return true;
      const { passkeyCancelled, passkeyNotAllowed } = classifyError(error);
      return passkeyCancelled || passkeyNotAllowed;
    },
    warnError: (error) => classifyError(error).passkeyWarning,
  },
});

const api = hc<ExaAPI>(domain === "localhost" ? "http://localhost:3000/api" : `https://${domain}/api`, {
  init: { credentials: "include" },
  fetch: async (input: Request | string | URL, init?: RequestInit) => {
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
    if (response.status === 404 && code === "no card") return null;
    if (response.status === 403 && code === "no panda") return null;
    throw new APIError(response.status, code);
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

export async function setCardStatus(status: "ACTIVE" | "DELETED" | "FROZEN") {
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

export async function getKYCTokens(scope: "basic" | "manteca" = "basic", redirectURI?: string) {
  await auth();
  const response = await api.kyc.$post({ json: { scope, redirectURI } });
  if (!response.ok) {
    const { code } = await response.json();
    throw new APIError(response.status, code);
  }
  return response.json();
}

export async function getKYCStatus(scope: "basic" | "manteca" = "basic", includeCountryCode?: boolean) {
  await auth();
  const query = { scope, countryCode: includeCountryCode ? "true" : undefined };
  const response = await api.kyc.$get({ query });
  if (!response.ok) {
    const { code } = await response.json();
    throw new APIError(response.status, code);
  }
  if (includeCountryCode) {
    const country = response.headers.get("User-Country");
    if (country) queryClient.setQueryData(["user", "country"], country);
  }
  return response.json();
}

export async function getMantecaKYCStatus() {
  return getKYCStatus("manteca");
}

export async function createMantecaKYC(redirectURI?: string) {
  await auth();
  const response = await api.kyc.$post({ json: { scope: "manteca", redirectURI } });
  if (!response.ok) {
    const { code } = await response.json();
    throw new APIError(response.status, code);
  }
  return response.json();
}

export async function getCredential() {
  const cached = queryClient.getQueryData<Credential>(["credential"]);
  if (cached) return cached;
  await auth();
  const credential = queryClient.getQueryData<Credential>(["credential"]);
  if (!credential) throw new Error("missing credential");
  return credential;
}

export async function createCredential() {
  const method = queryClient.getQueryData<AuthMethod>(["method"]);
  const credentialId = method === "siwe" ? getConnection(ownerConfig).address : undefined;
  if (method === "siwe" && !credentialId) throw new Error("invalid operation");
  const get = await api.auth.registration.$get({ query: { credentialId } });
  const sessionId = get.headers.get("x-session-id");
  const options = await get.json();
  const post = await api.auth.registration.$post(
    {
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
    },
    sessionId ? { headers: { "x-session-id": sessionId } } : undefined,
  );
  if (!post.ok) throw new APIError(post.status, stringOrLegacy(await post.json()));
  const { auth: expires, intercomToken, ...credential } = await post.json();
  await loginIntercom(deriveAddress(credential.factory, { x: credential.x, y: credential.y }), intercomToken);
  await queryClient.setQueryData(["auth"], parse(Auth, expires));
  return parse(Credential, credential);
}

export type Activity = Exclude<InferResponseType<typeof api.activity.$get, 200>, string | Uint8Array>;
export type CardActivity = Extract<Activity[number], { type: "card" | "panda" }>;

async function getActivity(
  parameters: NonNullable<NonNullable<Parameters<typeof api.activity.$get>[0]>["query"]> & {
    maturity: NonNullable<NonNullable<NonNullable<Parameters<typeof api.activity.$get>[0]>["query"]>["maturity"]>;
  },
  accept: "application/pdf",
): Promise<Uint8Array>;
async function getActivity(
  parameters?: NonNullable<Parameters<typeof api.activity.$get>[0]>["query"],
): Promise<Activity>;
async function getActivity(
  parameters?: NonNullable<Parameters<typeof api.activity.$get>[0]>["query"],
  accept?: "application/pdf",
): Promise<Activity | Uint8Array> {
  await auth();
  const response = await api.activity.$get(parameters === undefined ? undefined : { query: parameters }, {
    headers: { accept: accept ?? "application/json" },
  });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  if (accept === "application/pdf") {
    if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("bad activity response");
    return new Uint8Array(await response.arrayBuffer());
  }
  const activity = await parseResponse(response);
  if (typeof activity === "string" || activity instanceof Uint8Array) throw new Error("bad activity response");
  return activity;
}
queryClient.setQueryDefaults(["activity"], { staleTime: 60_000, gcTime: 60 * 60_000, queryFn: () => getActivity() });
queryClient.setQueryDefaults(["activity", "card"], {
  queryFn: async () => {
    const activity = await getActivity({ include: "card" });
    return activity.filter((item): item is CardActivity => item.type === "card" || item.type === "panda");
  },
});
queryClient.setQueryDefaults(["activity", "details"], {
  staleTime: Infinity,
  gcTime: Infinity,
  queryFn: () => {
    throw new Error("don't refetch");
  },
});

let authenticating: Promise<void> | undefined;
export async function auth() {
  if (authenticating) return authenticating;
  if (safeParse(Auth, queryClient.getQueryData<number | undefined>(["auth"])).success) return;
  await (authenticating = queryClient
    .fetchQuery({ ...queryClient.getQueryDefaults(["auth"]), queryKey: ["auth"], staleTime: 0 })
    .finally(() => {
      authenticating = undefined;
    }));
}

const Auth = pipe(
  number("no auth"),
  check((expires) => Date.now() < expires, "auth expired"),
);

export { APIError } from "./queryClient";

function stringOrLegacy(response: string | { code: string } | { legacy: string }) {
  if (typeof response === "string") return response;
  if ("code" in response && typeof response.code === "string") return response.code;
  if ("legacy" in response && typeof response.legacy === "string") return response.legacy;
  throw new Error("invalid api response");
}

export async function getPaxId() {
  await auth();
  const response = await api.pax.$get();
  if (!response.ok) {
    const { code } = await response.json();
    throw new APIError(response.status, code);
  }
  return response.json();
}

queryClient.setQueryDefaults(["pax", "id"], { queryFn: getPaxId });
export type PaxId = Awaited<ReturnType<typeof getPaxId>>;

export async function getRampProviders(countryCode?: string, redirectURL?: string) {
  await auth();
  const query = { countryCode, redirectURL };
  const response = await api.ramp.$get({ query });
  if (!response.ok) {
    const { code } = await response.json();
    throw new APIError(response.status, code);
  }
  return response.json();
}

export async function getRampQuote(query: NonNullable<Parameters<typeof api.ramp.quote.$get>[0]>["query"]) {
  await auth();
  const response = await api.ramp.quote.$get({ query });
  if (!response.ok) {
    const { code } = await response.json();
    throw new APIError(response.status, code);
  }
  return response.json();
}

export async function startRampOnboarding(onboarding: { provider: "manteca" }) {
  await auth();
  const response = await api.ramp.$post({ json: onboarding });
  if (!response.ok) {
    const body = await response.json();
    if (body.code === "invalid legal id") {
      const { inquiryId, sessionToken } = parse(object({ inquiryId: string(), sessionToken: string() }), body);
      return { code: body.code, inquiryId, sessionToken };
    }
    throw new APIError(response.status, body.code);
  }
  return response.json();
}
