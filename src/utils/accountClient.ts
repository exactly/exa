import { Platform } from "react-native";
import { get } from "react-native-passkeys";

import {
  buildUserOperationFromTx,
  createBundlerClient,
  createSmartAccountClient,
  deepHexlify,
  defaultUserOpSigner,
  getEntryPoint,
  resolveProperties,
  smartAccountClientActions,
  toSmartContractAccount,
  type SmartContractAccount,
  type UserOperationStruct_v6,
} from "@aa-sdk/core";
import { alchemyGasManagerMiddleware } from "@account-kit/infra";
// @ts-expect-error deep import to avoid broken dependency
import { standardExecutor } from "@account-kit/smart-contracts/dist/esm/src/msca/account/standardExecutor"; // cspell:ignore msca
import { ECDSASigValue } from "@peculiar/asn1-ecc";
import { AsnParser } from "@peculiar/asn1-schema";
import { setUser } from "@sentry/react-native";
import {
  base64URLStringToBuffer,
  bufferToBase64URLString,
  type AuthenticatorAssertionResponseJSON,
} from "@simplewebauthn/browser";
import { getCallsStatus, getConnection, sendCalls, sendTransaction, signMessage } from "@wagmi/core/actions";
import {
  bytesToBigInt,
  bytesToHex,
  concat,
  concatHex,
  custom,
  encodeAbiParameters,
  encodePacked,
  ethAddress,
  hashMessage,
  hexToBytes,
  hexToNumber,
  isHex,
  maxUint256,
  numberToHex,
  sliceHex,
  trim,
  type Address,
  type Call,
  type Hex,
  type TransactionRequest,
} from "viem";
import { anvil } from "viem/chains";

import accountInit from "@exactly/common/accountInit";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import chain, { upgradeableModularAccountAbi } from "@exactly/common/generated/chain";

import e2e from "./e2e";
import { login } from "./onesignal";
import publicClient from "./publicClient";
import queryClient, { type AuthMethod } from "./queryClient";
import ownerConfig from "./wagmi/owner";

import type { Credential } from "@exactly/common/validation";

if (chain.id !== anvil.id && !alchemyGasPolicyId) throw new Error("missing alchemy gas policy");

export default async function createAccountClient({ credentialId, factory, x, y }: Credential) {
  const accountAddress = deriveAddress(factory, { x, y });
  setUser({ id: accountAddress });
  login(accountAddress);
  const transport = custom(publicClient);
  const entryPoint = getEntryPoint(chain);
  const account = await toSmartContractAccount({
    chain,
    transport,
    entryPoint,
    accountAddress,
    source: "WebauthnAccount" as const,
    getAccountInitCode: () => Promise.resolve(concatHex([factory, accountInit({ x, y })])),
    getDummySignature: () => DUMMY_SIGNATURE,
    signUserOperationHash: async (uoHash) => {
      try {
        if (queryClient.getQueryData<AuthMethod>(["method"]) === "siwe" && getConnection(ownerConfig).address) {
          return wrapSignature(0, await signMessage(ownerConfig, { message: { raw: uoHash } }));
        }
        const credential = await get({
          rpId: domain,
          challenge: bufferToBase64URLString(
            hexToBytes(hashMessage({ raw: uoHash }), { size: 32 }).buffer as ArrayBuffer,
          ),
          allowCredentials: Platform.OS === "android" ? [] : [{ id: credentialId, type: "public-key" }], // HACK fix android credential filtering
          userVerification: "preferred",
        });
        if (!credential) throw new Error("no credential");
        const response: AuthenticatorAssertionResponseJSON = credential.response;
        const clientDataJSON = new TextDecoder().decode(base64URLStringToBuffer(response.clientDataJSON));
        const typeIndex = BigInt(clientDataJSON.indexOf('"type":"'));
        const challengeIndex = BigInt(clientDataJSON.indexOf('"challenge":"'));
        const authenticatorData = bytesToHex(new Uint8Array(base64URLStringToBuffer(response.authenticatorData)));
        const signature = AsnParser.parse(base64URLStringToBuffer(response.signature), ECDSASigValue);
        const r = bytesToBigInt(new Uint8Array(signature.r));
        let s = bytesToBigInt(new Uint8Array(signature.s));
        if (s > P256_N / 2n) s = P256_N - s; // pass malleability guard
        return webauthn({ authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s });
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          (error.message ===
            "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" ||
            error.message ===
              "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1004.)" ||
            error.message === "The operation couldn’t be completed. Device must be unlocked to perform request." ||
            error.message === "UserCancelled")
        ) {
          return "0x";
        }
        throw error;
      }
    },
    signMessage: () => Promise.reject(new Error("not implemented")),
    signTypedData: () => Promise.reject(new Error("not implemented")),
    ...(standardExecutor as Pick<SmartContractAccount, "encodeBatchExecute" | "encodeExecute">),
  });
  const client = createSmartAccountClient({
    chain,
    transport,
    account,
    ...(alchemyGasPolicyId
      ? alchemyGasManagerMiddleware(alchemyGasPolicyId)
      : {
          gasEstimator(struct) {
            struct.preVerificationGas = 1_000_000n;
            struct.verificationGasLimit = 5_000_000n;
            struct.callGasLimit = 10_000_000n;
            return Promise.resolve(struct);
          },
          dummyPaymasterAndData: (struct) => Promise.resolve({ ...struct, paymasterAndData: ethAddress }),
          paymasterAndData: (struct) => Promise.resolve({ ...struct, paymasterAndData: ethAddress }),
        }),
    async customMiddleware(userOp) {
      if ((await userOp.signature) === DUMMY_SIGNATURE) {
        // dynamic dummy signature
        userOp.signature = dummySignature(
          bufferToBase64URLString(
            hexToBytes(hashMessage({ raw: deepHexlify(await resolveProperties(userOp)) as Hex }), { size: 32 })
              .buffer as ArrayBuffer,
          ),
        );
      }
      return userOp;
    },
  });
  return createBundlerClient({
    chain,
    // @ts-expect-error -- bad alchemy types
    account,
    type: "SmartAccountClient",
    transport: custom({
      async request({ method, params }) {
        switch (method) {
          case "wallet_sendCalls": {
            if (!Array.isArray(params) || params.length !== 1) throw new Error("bad params");
            const { calls, from, id } = params[0] as { calls: readonly Call[]; from?: Address; id?: string };
            if (from && from !== accountAddress) throw new Error("bad account");
            if (queryClient.getQueryData<AuthMethod>(["method"]) === "webauthn") {
              const { hash } = await client.sendUserOperation({
                uo: calls.map(({ to, data = "0x", value }) => ({ from: accountAddress, target: to, data, value })),
              });
              return { id: concat([hash, numberToHex(chain.id, { size: 32 }), UO_MAGIC_ID]) };
            }
            const execute = {
              to: accountAddress,
              functionName: "executeBatch",
              args: [calls.map(({ to, data = "0x", value = 0n }) => ({ target: to, data, value }))],
              abi: upgradeableModularAccountAbi,
            } as const;
            try {
              return await sendCalls(ownerConfig, {
                id,
                calls: [execute],
                capabilities: {
                  paymasterService: {
                    optional: true,
                    url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
                    context: { policyId: alchemyGasPolicyId },
                  },
                },
              });
            } catch {
              // TODO filter errors
              const hash = await sendTransaction(ownerConfig, execute);
              return { id: concat([hash, numberToHex(chain.id, { size: 32 }), TX_MAGIC_ID]) };
            }
          }
          case "wallet_getCallsStatus": {
            if (!Array.isArray(params) || params.length !== 1 || typeof params[0] !== "string") throw new Error("bad");
            if (params[0].endsWith(UO_MAGIC_ID.slice(2)) && isHex(params[0]) && params[0].length === 194) {
              const receipt = await client.getUserOperationReceipt(sliceHex(params[0], 0, 32));
              return {
                version: "2.0.0",
                id: params[0],
                atomic: true,
                receipts: receipt ? [receipt.receipt] : [],
                status: receipt ? (receipt.success ? 200 : 500) : 100,
                chainId: hexToNumber(trim(sliceHex(params[0], -64, -32))),
              };
            }
            const result = await getCallsStatus(ownerConfig, { id: params[0] });
            return { ...result, status: result.statusCode };
          }
          case "eth_sendTransaction": {
            if (!Array.isArray(params) || params.length !== 1) throw new Error("bad params");
            if (!e2e) {
              try {
                const { to, data = "0x", value = 0n } = params[0] as TransactionRequest;
                const { id } = await sendCalls(ownerConfig, {
                  calls: [
                    {
                      to: accountAddress,
                      functionName: "executeBatch",
                      args: [[{ target: to ?? "0x", data, value }]],
                      abi: upgradeableModularAccountAbi,
                    },
                  ],
                  capabilities: {
                    paymasterService: {
                      optional: true,
                      url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
                      context: { policyId: alchemyGasPolicyId },
                    },
                  },
                });
                return id;
              } catch {
                // TODO filter errors
                return client.request({ method: method as never, params: params as never });
              }
            }
            const uo = (await resolveProperties(
              await defaultUserOpSigner(await buildUserOperationFromTx(client, params[0] as TransactionRequest), {
                client,
                account: client.account,
              }),
            )) as Required<UserOperationStruct_v6>;
            const hash = await e2e.writeContract({
              address: entryPoint.address,
              functionName: "handleOps",
              abi: entryPoint.abi,
              args: [
                [
                  {
                    sender: uo.sender as Hex,
                    nonce: BigInt(uo.nonce),
                    initCode: uo.initCode as Hex,
                    callData: uo.callData as Hex,
                    callGasLimit: BigInt(uo.callGasLimit),
                    preVerificationGas: BigInt(uo.preVerificationGas),
                    verificationGasLimit: BigInt(uo.verificationGasLimit),
                    maxFeePerGas: BigInt(uo.maxFeePerGas),
                    maxPriorityFeePerGas: BigInt(uo.maxPriorityFeePerGas),
                    paymasterAndData: uo.paymasterAndData as Hex,
                    signature: uo.signature as Hex,
                  },
                ],
                e2e.account.address,
              ],
            });
            await publicClient.waitForTransactionReceipt({ hash });
            return hash;
          }
          default:
            return client.request({ method: method as never, params: params as never });
        }
      },
    }),
  }).extend(smartAccountClientActions) as unknown as typeof client;
}

function wrapSignature(ownerIndex: number, signature: Hex) {
  return encodePacked(["uint8", "bytes"], [ownerIndex, signature]);
}

function dummySignature(challenge: string) {
  return webauthn({
    authenticatorData: "0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000000",
    clientDataJSON: `{"type":"webauthn.get","challenge":"${challenge}","origin":"https://web.exactly.app","crossOrigin":false}`,
    typeIndex: 1n,
    challengeIndex: 23n,
    r: maxUint256,
    s: P256_N / 2n,
  });
}

const UO_MAGIC_ID = "0x4337433743374337433743374337433743374337433743374337433743374337";
const TX_MAGIC_ID = "0x5792579257925792579257925792579257925792579257925792579257925792";
const P256_N = 0xff_ff_ff_ff_00_00_00_00_ff_ff_ff_ff_ff_ff_ff_ff_bc_e6_fa_ad_a7_17_9e_84_f3_b9_ca_c2_fc_63_25_51n;
const DUMMY_SIGNATURE = dummySignature("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

function webauthn({
  authenticatorData,
  clientDataJSON,
  challengeIndex,
  typeIndex,
  r,
  s,
}: {
  authenticatorData: Hex;
  challengeIndex: bigint;
  clientDataJSON: string;
  r: bigint;
  s: bigint;
  typeIndex: bigint;
}) {
  return wrapSignature(
    0,
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "bytes", name: "authenticatorData" },
            { type: "string", name: "clientDataJSON" },
            { type: "uint256", name: "challengeIndex" },
            { type: "uint256", name: "typeIndex" },
            { type: "uint256", name: "r" },
            { type: "uint256", name: "s" },
          ],
        },
      ],
      [{ authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s }],
    ),
  );
}
