import { captureException } from "@sentry/node";
import { env } from "node:process";
import { array, number, object, optional, parse, string, tuple, type InferInput } from "valibot";
import { createWalletClient, http, toHex, type LocalAccount } from "viem";
import { baseSepolia, optimismSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { getAccount, withExaSend } from "./accounts";
import { captureRequests, Requests } from "./publicClient";
import redis from "./redis";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");

if (!env.PANDA_API_URL) throw new Error("missing PANDA_API_URL");
const apiUrl = process.env.PANDA_API_URL?.replace(/\/v1$/, "");

const controllerAddress =
  {
    [baseSepolia.id]: parse(Address, "0x54d02DcB38B76A67dC9368D8457D1F384B865c70"),
  }[chain.id] ?? parse(Address, "0x54d02DcB38B76A67dC9368D8457D1F384B865c70");

const assetAddress =
  {
    [baseSepolia.id]: parse(Address, "0x29684075a3C86ea11D9964BcAf0F956e801396bD"),
  }[chain.id] ?? parse(Address, "0x29684075a3C86ea11D9964BcAf0F956e801396bD");

const domain =
  {
    [baseSepolia.id]: "use-dev.rain.xyz" as const,
    [optimismSepolia.id]: "use-dev.rain.xyz" as const,
  }[chain.id] ?? ("use.rain.xyz" as const);

const teamName =
  {
    [baseSepolia.id]: "Exa Labs - Base Sepolia" as const,
    [optimismSepolia.id]: "Exa Labs" as const,
  }[chain.id] ?? ("Exa Labs - Base Sepolia" as const);

const key = `refunder-${chain.id}` as const;

const Signature = object({
  status: string(),
  signature: object({ data: string(), salt: string() }),
  expiresAt: string(),
  sender: string(),
  chainId: string(),
  parameters: tuple([string(), string(), string(), string(), number(), array(number()), string()]),
});

const Auth = object({
  teamId: string(),
  headers: object({ Cookie: string(), Authorization: string(), "x-csrf-token": optional(string(), "") }),
});

const Nonce = object({ nonce: string() });

const Team = object({ teams: array(object({ userId: string(), name: string() })) });

const Authentication = object({ token: string(), user: object({ teamId: string() }) });

const Profile = object({ csrfToken: string(), user: object({ teamId: string() }) });

async function findAuth() {
  return redis.get(key).then((cached) => (cached ? parse(Auth, JSON.parse(cached)) : undefined));
}

function createMessage(nonce: string, address: Address) {
  return {
    domain,
    address,
    statement:
      "Welcome to Rain! Please sign in with your wallet. By signing in, you accept the Rain Card Terms (https://www.rain.xyz/legal/docs/corporate-card-terms) and User Agreements (https://www.rain.xyz/legal/docs/corporate-card-user-agreement)",
    uri: `https://${domain}`,
    version: "1" as const,
    chainId: chain.id,
    nonce,
    issuedAt: new Date(),
  };
}

async function getChallenge() {
  const response = await fetch(`${apiUrl}/auth/wallet/generate-nonce`);
  if (!response.ok) throw new Error(`nonce fetch failed: ${response.status} ${await response.text()}`);
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie?.includes("sessionId=")) throw new Error("no session cookie received");
  const nonce = parse(Nonce, await response.json()).nonce;
  return { nonce, cookie: setCookie };
}

async function authenticate(challenge: { cookie: string; nonce: string }, account: LocalAccount, userId: string) {
  const message = createMessage(challenge.nonce, parse(Address, account.address));
  const signature = await account.signMessage({ message: createSiweMessage(message) });
  const response = await fetch(`${apiUrl}/auth/wallet/verify-sign-in-message`, {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: challenge.cookie },
    body: JSON.stringify({ message, signature, userId }),
  });
  if (!response.ok) throw new Error(`authenticate failed: ${response.status} ${await response.text()}`);
  const parsed = parse(Authentication, await response.json());
  return { teamId: parsed.user.teamId, Authorization: `Bearer ${parsed.token}` };
}

async function getProfile(headers: InferInput<typeof Auth>["headers"]) {
  const response = await fetch(`${apiUrl}/me`, { headers: { ...headers } });
  if (response.status === 401) return;
  if (!response.ok) return;
  const rawData = await response.arrayBuffer();
  if (rawData.byteLength === 0) return;
  const profile = parse(Profile, JSON.parse(new TextDecoder().decode(rawData)));
  return { "x-csrf-token": profile.csrfToken };
}

async function getTeamUserId(challenge: { cookie: string; nonce: string }, account: LocalAccount) {
  const message = createMessage(challenge.nonce, parse(Address, account.address));
  const signature = await account.signMessage({ message: createSiweMessage(message) });
  const response = await fetch(`${apiUrl}/auth/wallet/get-teams`, {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: challenge.cookie },
    body: JSON.stringify({ message, signature }),
  });
  if (!response.ok) throw new Error(`get-teams failed: ${response.status} ${await response.text()}`);
  const teamResponse = parse(Team, await response.json());
  const team = teamResponse.teams.find((t) => t.name === teamName);
  if (!team) throw new Error(`team "${teamName}" not found`);
  return team.userId;
}

async function login(account: LocalAccount) {
  return findAuth().then(async (auth) => {
    return auth
      ? getProfile(auth.headers).then((profile) => ({ ...auth.headers, ...profile }))
      : getChallenge().then(async (challenge) => {
          return getTeamUserId(challenge, account).then(async (userId) => {
            return authenticate(challenge, account, userId).then(async ({ Authorization, teamId }) => {
              const fresh = await getProfile({ Authorization, Cookie: challenge.cookie });
              if (!fresh) throw new Error("authentication succeeded but profile fetch failed");
              const value = {
                teamId,
                headers: { Authorization, Cookie: challenge.cookie, "x-csrf-token": fresh["x-csrf-token"] },
              };
              await redis.set(key, JSON.stringify(value));
              return value.headers;
            });
          });
        });
  });
}

const initPromise = (async function () {
  async function initialize() {
    return getAccount("refunder").then((account) => {
      const client = createWalletClient({
        chain,
        transport: http(`${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`, {
          batch: true,
          async onFetchRequest(request) {
            try {
              captureRequests(parse(Requests, await request.clone().json()));
            } catch (error: unknown) {
              captureException(error);
            }
          },
        }),
        account,
      }).extend((wallet) => {
        const { exaSend } = withExaSend(wallet);
        return {
          async withdraw(amount: bigint, recipient: Address) {
            return login(account)
              .then(async (auth) => {
                const response = await fetch(`${apiUrl}/collateral/signature/withdraw`, {
                  method: "POST",
                  headers: { "content-type": "application/json", ...auth },
                  body: JSON.stringify({
                    chainId: `0x${chain.id.toString(16)}`,
                    assetAddress,
                    assetAmountCents: String(amount / 10_000n),
                    userAddress: account.address,
                    recipientAddress: recipient,
                  }),
                });
                if (!response.ok) {
                  throw new Error(`withdraw signature failed: ${response.status} ${await response.text()}`);
                }
                return parse(Signature, await response.json());
              })
              .then((signature) => {
                return exaSend(
                  { name: "panda.withdraw", op: "panda.withdraw", attributes: { account: recipient } },
                  {
                    address: controllerAddress,
                    functionName: "withdrawAsset",
                    args: [
                      signature.parameters[0],
                      signature.parameters[1],
                      signature.parameters[2],
                      signature.parameters[3],
                      signature.parameters[4],
                      toHex(new Uint8Array(signature.parameters[5])),
                      signature.parameters[6],
                    ],
                    abi: [
                      {
                        inputs: [
                          { internalType: "address", name: "_collateralProxy", type: "address" },
                          { internalType: "address", name: "_asset", type: "address" },
                          { internalType: "uint256", name: "_amount", type: "uint256" },
                          { internalType: "address", name: "_recipient", type: "address" },
                          { internalType: "uint256", name: "_expiresAt", type: "uint256" },
                          { internalType: "bytes32", name: "_salt", type: "bytes32" },
                          { internalType: "bytes", name: "_signature", type: "bytes" },
                        ],
                        name: "withdrawAsset" as const,
                        outputs: [] as const,
                        stateMutability: "nonpayable" as const,
                        type: "function" as const,
                      },
                    ],
                  },
                );
              });
          },
        };
      });

      return client;
    });
  }

  return initialize();
})();

export default async function refunder() {
  return initPromise;
}
