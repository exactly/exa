import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import { Passkey } from "@exactly/common/validation";
import { createAPIClient } from "@exactly/sdk";
import { signMessage } from "@wagmi/core/actions";
import { Platform } from "react-native";
import { get as assert, create } from "react-native-passkeys";
import { check, number, parse, pipe, safeParse } from "valibot";
import { UserRejectedRequestError } from "viem";

import {
  connectAccount as connectInjectedAccount,
  getAccount as getInjectedAccount,
  config as injectedConfig,
  connector as injectedConnector,
} from "./injectedConnector";
import { encryptPIN, session } from "./panda";
import queryClient, { APIError } from "./queryClient";

queryClient.setQueryDefaults<number | undefined>(["auth"], {
  staleTime: AUTH_EXPIRY,
  gcTime: AUTH_EXPIRY,
  retry: false,
  queryFn: async () => {
    const get = await api.auth.authentication.$get({
      query: {
        credentialId: (await getInjectedAccount()) ?? queryClient.getQueryData<Passkey>(["passkey"])?.credentialId,
      },
    });
    const options = await get.json();
    try {
      const post = await api.auth.authentication.$post({
        json:
          options.method === "siwe"
            ? await connectInjectedAccount(options.address).then(async () => ({
                method: "siwe" as const,
                id: options.address,
                signature: await signMessage(injectedConfig, {
                  connector: injectedConnector,
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
              }),
      });
      if (!post.ok) throw new APIError(post.status, stringOrLegacy(await post.json()));
      const { expires } = await post.json();
      return parse(Auth, expires);
    } catch (error: unknown) {
      if (
        error instanceof UserRejectedRequestError ||
        (error instanceof Error &&
          (error.message ===
            "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" ||
            error.message === "The operation couldn’t be completed. Device must be unlocked to perform request." ||
            error.message === "UserCancelled"))
      ) {
        return queryClient.getQueryData<number>(["auth"]) ?? 0;
      }
      throw error;
    }
  },
});

const api = createAPIClient(domain === "localhost" ? "http://localhost:3000/api" : `https://${domain}/api`);

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

export async function getPasskey() {
  await auth();
  const response = await api.passkey.$get();
  if (!response.ok) throw new APIError(response.status, stringOrLegacy(await response.json()));
  return response.json();
}

export async function createCredential() {
  const get = await api.auth.registration.$get({ query: { credentialId: await getInjectedAccount() } });
  const options = await get.json();
  const post = await api.auth.registration.$post({
    json:
      options.method === "siwe"
        ? await connectInjectedAccount(options.address).then(async () => ({
            method: "siwe" as const,
            id: options.address,
            signature: await signMessage(injectedConfig, {
              connector: injectedConnector,
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
  return parse(Passkey, passkey);
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
