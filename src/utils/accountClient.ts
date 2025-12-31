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
import accountInitCode from "@exactly/common/accountInitCode";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import type { Credential } from "@exactly/common/validation";
import { ECDSASigValue } from "@peculiar/asn1-ecc";
import { AsnParser } from "@peculiar/asn1-schema";
import { setUser } from "@sentry/react-native";
import {
  base64URLStringToBuffer,
  bufferToBase64URLString,
  type AuthenticatorAssertionResponseJSON,
} from "@simplewebauthn/browser";
import { getConnection, signMessage } from "@wagmi/core/actions";
import { Platform } from "react-native";
import { get } from "react-native-passkeys";
import {
  bytesToBigInt,
  bytesToHex,
  custom,
  encodeAbiParameters,
  encodePacked,
  ethAddress,
  hashMessage,
  hexToBytes,
  maxUint256,
  type Hex,
  type TransactionRequest,
} from "viem";
import { anvil } from "viem/chains";

import e2e from "./e2e";
import { login } from "./onesignal";
import publicClient from "./publicClient";
import queryClient, { type AuthMethod } from "./queryClient";
import ownerConfig from "./wagmi/owner";

if (chain.id !== anvil.id && !alchemyGasPolicyId) throw new Error("missing alchemy gas policy");

export default async function createAccountClient({ credentialId, factory, x, y }: Credential) {
  const transport = custom(publicClient);
  const entryPoint = getEntryPoint(chain);
  const account = await toSmartContractAccount({
    chain,
    transport,
    entryPoint,
    source: "WebauthnAccount" as const,
    getAccountInitCode: () => Promise.resolve(accountInitCode({ factory, x, y })),
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
    ...(standardExecutor as Pick<SmartContractAccount, "encodeExecute" | "encodeBatchExecute">),
  });
  setUser({ id: account.address });
  login(account.address);
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
  return e2e
    ? (createBundlerClient({
        chain,
        // @ts-expect-error -- bad alchemy types
        account,
        type: "SmartAccountClient",
        transport: custom({
          async request({ method, params }) {
            switch (method) {
              case "eth_sendTransaction": {
                if (!e2e || !Array.isArray(params) || params.length !== 1) throw new Error("type narrowing");
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
                return client.request({ method, params }); // eslint-disable-line @typescript-eslint/no-unsafe-assignment,
            }
          },
        }),
      }).extend(smartAccountClientActions) as unknown as typeof client)
    : client;
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
  clientDataJSON: string;
  challengeIndex: bigint;
  typeIndex: bigint;
  r: bigint;
  s: bigint;
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
