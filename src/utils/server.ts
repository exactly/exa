import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import { Credential } from "@exactly/common/validation";
import type { ExaAPI } from "@exactly/server/api";
import { signMessage } from "@wagmi/core/actions";
import { hc } from "hono/client";
import { Platform } from "react-native";
import { get as assert, create } from "react-native-passkeys";
import { check, number, parse, pipe, safeParse, ValiError } from "valibot";

import {
  connectAccount,
  getAccount as getInjectedAccount,
  config as injectedConfig,
  getConnector,
} from "./injectedConnector";
import { encryptPIN, session } from "./panda";
import queryClient, { APIError } from "./queryClient";

queryClient.setQueryDefaults<number | undefined>(["auth"], {
  retry: false,
  enabled: false,
  staleTime: AUTH_EXPIRY,
  gcTime: AUTH_EXPIRY,
  queryFn: async () => {
    const method = queryClient.getQueryData<"siwe" | "webauthn" | undefined>(["method"]);
    const credentialId =
      method === "siwe"
        ? await getInjectedAccount()
        : queryClient.getQueryData<Credential>(["credential"])?.credentialId;
    if (method === "siwe" && !credentialId) return queryClient.getQueryData<number>(["auth"]) ?? 0;
    const get = await api.auth.authentication.$get({ query: { credentialId } });
    const options = await get.json();
    if (options.method === "webauthn" && Platform.OS === "android") delete options.allowCredentials; // HACK fix android credential filtering
    const json =
      options.method === "siwe"
        ? await connectAccount(options.address).then(async () => ({
            method: "siwe" as const,
            id: options.address,
            signature: await signMessage(injectedConfig, {
              connector: await getConnector(),
              account: options.address,
              message: options.message,
            }),
          }))
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
    const { expires } = await post.json();
    return parse(Auth, expires);
  },
  meta: {
    suppressError: (error) =>
      error instanceof ValiError ||
      (error instanceof Error &&
        (error.name === "NotAllowedError" ||
          error.message ===
            "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" ||
          error.message === "The operation couldn’t be completed. Device must be unlocked to perform request." ||
          error.message === "UserCancelled")),
  },
});

const api = hc<ExaAPI>(domain === "localhost" ? "http://localhost:3000/api" : `https://${domain}/api`, {
  init: { credentials: "include" },
});

export async function getCard() {
  await auth();
  const { id, secret } = await session();
  const response = await api.card.$get({ header: { sessionid: id } });
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  const card = await response.json();
  return { ...card, secret };
}

export async function createCard() {
  await auth();
  const response = await api.card.$post();
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function setCardStatus(status: "ACTIVE" | "FROZEN") {
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

export async function getKYCLink(templateId: string) {
  await auth();
  const response = await api.kyc.$post({ json: { templateId } });
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
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function createCredential() {
  const method = queryClient.getQueryData<"siwe" | "webauthn" | undefined>(["method"]);
  const credentialId = method === "siwe" ? await getInjectedAccount() : undefined;
  if (method === "siwe" && !credentialId) throw new Error("invalid operation");
  const get = await api.auth.registration.$get({ query: { credentialId } });
  const options = await get.json();
  const post = await api.auth.registration.$post({
    json:
      options.method === "siwe"
        ? await connectAccount(options.address).then(async () => ({
            method: options.method,
            id: options.address,
            signature: await signMessage(injectedConfig, {
              connector: await getConnector(),
              account: options.address,
              message: options.message,
            }),
          }))
        : await create({
            ...options,
            extensions: options.extensions as Record<string, unknown> | undefined,
          }).then((attestation) => {
            if (!attestation) throw new Error("bad attestation");
            return attestation;
          }),
  });
  if (!post.ok) throw new APIError(post.status, stringOrLegacy(await post.json()));
  const { auth: expires, ...passkey } = await post.json();
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
