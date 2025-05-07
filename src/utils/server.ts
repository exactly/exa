import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import chain, { exaAccountFactoryAddress, exaPluginAddress } from "@exactly/common/generated/chain";
import { Address, Passkey } from "@exactly/common/validation";
import type { ExaAPI } from "@exactly/server/api";
import { signMessage } from "@wagmi/core/actions";
import { hc } from "hono/client";
import { Platform } from "react-native";
import { get as assert, create } from "react-native-passkeys";
import { check, number, parse, pipe, safeParse } from "valibot";
import { UserRejectedRequestError, zeroAddress, type EIP1193Provider } from "viem";

import { accountClient } from "./alchemyConnector";
import { session } from "./panda";
import publicClient from "./publicClient";
import queryClient, { APIError } from "./queryClient";
import reportError from "./reportError";
import wagmiConfig from "./wagmi";
import { upgradeableModularAccountAbi } from "../generated/contracts";

queryClient.setQueryDefaults<number | undefined>(["auth"], {
  staleTime: AUTH_EXPIRY,
  gcTime: AUTH_EXPIRY,
  retry: false,
  queryFn: async () => {
    const injected = await getInjected();
    const get = await api.auth.authentication.$get({
      query: injected.address
        ? { method: "siwe", credentialId: injected.address }
        : { method: "webauthn", credentialId: queryClient.getQueryData<Passkey>(["passkey"])?.credentialId },
    });
    const options = await get.json();
    try {
      const post = await api.auth.authentication.$post({
        json:
          options.method === "siwe"
            ? await signMessage(wagmiConfig, {
                connector: injected.connector,
                account: options.address,
                message: options.message,
              }).then((signature) => ({ method: "siwe" as const, id: options.address, signature }))
            : await assert({
                ...options,
                allowCredentials: Platform.OS === "android" ? undefined : options.allowCredentials, // HACK fix android credential filtering
                extensions: options.extensions as Record<string, unknown> | undefined,
              }).then((assertion) => {
                if (!assertion) throw new Error("bad assertion");
                return { method: "webauthn" as const, ...assertion };
              }),
      });
      if (!post.ok) throw new APIError(post.status, await post.json());
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

const api = hc<ExaAPI>(domain === "localhost" ? "http://localhost:3000/api" : `https://${domain}/api`, {
  init: { credentials: "include" },
});

export async function getCard() {
  await auth();
  const { id, secret } = await session();
  const response = await api.card.$get({}, { headers: { SessionId: id } });
  if (!response.ok) throw new APIError(response.status, await response.json());
  const card = await response.json();
  return { ...card, secret };
}

export async function createCard() {
  await auth();
  const response = await api.card.$post();
  if (!response.ok) throw new APIError(response.status, await response.json());
  return response.json();
}

export async function setCardStatus(status: "ACTIVE" | "FROZEN") {
  await auth();
  const response = await api.card.$patch({ json: { status } });
  if (!response.ok) throw new APIError(response.status, await response.json());
  return response.json();
}

export async function setCardMode(mode: number) {
  await auth();
  const response = await api.card.$patch({ json: { mode } });
  if (!response.ok) throw new APIError(response.status, await response.json());
  return response.json();
}

export async function getKYCLink() {
  await auth();
  const response = await api.kyc.$post({ json: { templateId: await getTemplateId() } });
  if (!response.ok) throw new APIError(response.status, await response.json());
  const result = await response.json();
  // @ts-expect-error intermediate api migration
  return typeof result === "string" ? result : (result.legacy as string);
}

export async function getKYCStatus() {
  await auth();
  const response = await api.kyc.$get({ query: { templateId: await getTemplateId() } });
  queryClient.setQueryData(["user", "country"], response.headers.get("User-Country"));
  if (!response.ok) throw new APIError(response.status, await response.json());
  const result = await response.json();
  return typeof result === "string"
    ? result
    : typeof result === "object" && "legacy" in result
      ? (result.legacy as string)
      : result;
}

export async function getPasskey() {
  await auth();
  const response = await api.passkey.$get();
  if (!response.ok) throw new APIError(response.status, await response.json());
  return response.json();
}

export async function createCredential() {
  const injected = await getInjected();
  const get = await api.auth.registration.$get({ query: { credentialId: injected.address } });
  const options = await get.json();
  const post = await api.auth.registration.$post({
    json:
      options.method === "siwe"
        ? await signMessage(wagmiConfig, {
            connector: injected.connector,
            account: options.address,
            message: options.message,
          }).then((signature) => ({ method: "siwe" as const, id: options.address, signature }))
        : await create({
            ...options,
            extensions: options.extensions as Record<string, unknown> | undefined,
          }).then((attestation) => {
            if (!attestation) throw new Error("bad attestation");
            return attestation;
          }),
  });
  if (!post.ok) throw new APIError(post.status, await post.json());
  const { auth: expires, ...passkey } = await post.json();
  await queryClient.setQueryData(["auth"], parse(Auth, expires));
  return parse(Passkey, passkey);
}

export async function getActivity(parameters?: NonNullable<Parameters<typeof api.activity.$get>[0]>["query"]) {
  await auth();
  const response = await api.activity.$get(
    parameters?.include === undefined ? undefined : { query: { include: parameters.include } },
  );
  if (!response.ok) throw new APIError(response.status, await response.json());
  return response.json();
}

export async function auth() {
  if (queryClient.isFetching({ queryKey: ["auth"] })) return;
  const { success } = safeParse(Auth, queryClient.getQueryData<number | undefined>(["auth"]));
  if (!success) await queryClient.fetchQuery<number | undefined>({ queryKey: ["auth"] });
}

async function getInjected() {
  const connector = wagmiConfig.connectors.find(({ id }) => id === "injected");
  if (!connector) throw new Error("no injected connector");
  try {
    if (await connector.isAuthorized()) {
      const accounts = await connector.getAccounts();
      return { connector, address: accounts[0] };
    }
    if (!(await connector.getProvider({ chainId: chain.id }))) return { connector, address: undefined };
    const { accounts } = await connector.connect({ chainId: chain.id });
    return { connector, address: accounts[0] };
  } catch (error: unknown) {
    reportError(error);
    return { connector, address: undefined };
  }
}

const PANDA_TEMPLATE = "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2";
const CRYPTOMATE_TEMPLATE = "itmpl_8uim4FvD5P3kFpKHX37CW817";

export async function getTemplateId() {
  try {
    const [exaPlugin] = await publicClient.readContract({
      address: accountClient?.account.address ?? zeroAddress,
      abi: upgradeableModularAccountAbi,
      functionName: "getInstalledPlugins",
    });
    return exaPlugin === exaPluginAddress
      ? PANDA_TEMPLATE
      : queryClient.getQueryData<Passkey>(["passkey"])?.factory === parse(Address, exaAccountFactoryAddress)
        ? CRYPTOMATE_TEMPLATE
        : PANDA_TEMPLATE;
  } catch {
    return queryClient.getQueryData<Passkey>(["passkey"])?.factory === parse(Address, exaAccountFactoryAddress)
      ? CRYPTOMATE_TEMPLATE
      : PANDA_TEMPLATE;
  }
}

const Auth = pipe(
  number(),
  check((expires) => Date.now() < expires, "auth expired"),
);

export { APIError } from "./queryClient";

declare global {
  interface Window {
    ethereum?: EIP1193Provider | undefined;
  }
}
