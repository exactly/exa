import { Platform } from "react-native";
import { get } from "react-native-passkeys";

import {
  buildUserOperation,
  createBundlerClient,
  createSmartAccountClient,
  defaultGasEstimator,
  getEntryPoint,
  smartAccountClientActions,
  toSmartContractAccount,
  type ClientMiddlewareArgs,
  type Deferrable,
  type GetEntryPointFromAccount,
  type MiddlewareClient,
  type SmartAccountClient,
  type SmartContractAccount,
  type UserOperationContext,
  type UserOperationStruct,
  type UserOperationStruct_v6,
} from "@aa-sdk/core";
import {
  alchemy,
  alchemyFeeEstimator,
  alchemyGasManagerMiddleware,
  createAlchemyPublicRpcClient,
  getAlchemyPaymasterAddress,
} from "@account-kit/infra";
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
import {
  getCallsStatus,
  getConnection,
  getConnectorClient,
  sendCalls,
  sendTransaction,
  signMessage,
  switchChain,
  waitForCallsStatus,
  waitForTransactionReceipt,
} from "@wagmi/core/actions";
import {
  BaseError,
  bytesToBigInt,
  bytesToHex,
  concat,
  concatHex,
  createClient,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  hashMessage,
  hexToBytes,
  hexToNumber,
  isHex,
  maxUint256,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  numberToHex,
  parseTransaction,
  RpcRequestError,
  serializeTransaction,
  sliceHex,
  trim,
  UnknownRpcError,
  zeroAddress,
  type Address,
  type Call,
  type Chain,
  type ExtractCapabilities,
  type Hex,
  type Transport,
} from "viem";
import {
  getBalance,
  readContract,
  sendRawTransaction,
  signTransaction,
  getCallsStatus as viemGetCallsStatus,
  sendCalls as viemSendCalls,
} from "viem/actions";

import accountInit from "@exactly/common/accountInit";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import { dataSuffix } from "@exactly/common/attribution";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import chain, { alchemyChains, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";
import { sum } from "@exactly/lib";

import {
  balancesOptions,
  bridgePolicyId,
  bridgePolicyTokens,
  gasReserveBuffer,
  lifiChainsOptions,
  type Spend,
} from "./lifi";
import { login } from "./onesignal";
import parseAmount from "./parseAmount";
import publicClient from "./publicClient";
import queryClient, { type AuthMethod } from "./queryClient";
import reportError, { classifyError } from "./reportError";
import { identify } from "./segment";
import ownerConfig from "./wagmi/owner";

import type { Credential } from "@exactly/common/validation";
import type { Token } from "@lifi/sdk";
import type { Config, SendCallsParameters } from "@wagmi/core";

export default async function createAccountClient({ credentialId, factory, x, y }: Credential) {
  const accountAddress = deriveAddress(factory, { x, y });
  setUser({ id: accountAddress });
  login(accountAddress);
  identify(accountAddress);
  const transport = custom(publicClient);
  const signUserOperationHash = async (uoHash: Hex): Promise<Hex> => {
    if (isSiwe()) return wrapSignature(0, await signMessage(ownerConfig, { message: { raw: uoHash } }));
    const credential = await get({
      rpId: domain,
      challenge: bufferToBase64URLString(hexToBytes(hashMessage({ raw: uoHash }), { size: 32 }).buffer as ArrayBuffer),
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
    s += (P256_N - 2n * s) * BigInt(s > P256_N / 2n); // pass malleability guard
    return webauthn({ authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s });
  };
  const accountOptions = {
    accountAddress,
    source: "WebauthnAccount" as const,
    getDummySignature: () => DUMMY_SIGNATURE,
    signUserOperationHash,
    signMessage: () => Promise.reject(new Error("not implemented")),
    signTypedData: () => Promise.reject(new Error("not implemented")),
    ...(standardExecutor as Pick<SmartContractAccount, "encodeBatchExecute" | "encodeExecute">),
  };
  const account = await toSmartContractAccount({
    chain,
    transport,
    entryPoint: getEntryPoint(chain),
    getAccountInitCode: () => getAccountInitCode(publicClient),
    ...accountOptions,
  });
  const client = createSmartAccountClient({
    chain,
    transport,
    account,
    ...alchemyGasManagerMiddleware(alchemyGasPolicyId),
    gasEstimator,
  });
  const crossChainAccounts = new Map<number, Promise<Remote>>();
  function getCrossChainAccount(targetChain: Chain) {
    const cached = crossChainAccounts.get(targetChain.id);
    if (cached) return cached;
    const alchemyTransport = alchemy({ apiKey: alchemyAPIKey });
    const targetClient = createAlchemyPublicRpcClient({ chain: targetChain, transport: alchemyTransport });
    const targetTransport = custom(targetClient);
    const promise = toSmartContractAccount({
      chain: targetChain,
      transport: targetTransport,
      entryPoint: getEntryPoint(targetChain),
      getAccountInitCode: () => getAccountInitCode(targetClient),
      ...accountOptions,
    })
      .then((targetAccount) => ({
        account: targetAccount,
        alchemyTransport,
        rpc: targetClient,
        readClient: createSmartAccountClient({
          chain: targetChain,
          transport: targetTransport,
          account: targetAccount,
        }),
        transport: targetTransport,
      }))
      .catch((error: unknown) => {
        crossChainAccounts.delete(targetChain.id);
        throw error;
      });
    crossChainAccounts.set(targetChain.id, promise);
    return promise;
  }
  async function getReadClient(chainId: number) {
    if (chainId === chain.id) return client;
    const targetChain = alchemyChains.get(chainId);
    if (!targetChain) throw new Error(`unsupported chain ${chainId}`);
    const { readClient } = await getCrossChainAccount(targetChain);
    return readClient;
  }
  async function plan(targetChain: Chain, calls: readonly Call[], spend?: Spend) {
    const {
      account: remoteAccount,
      alchemyTransport,
      rpc,
      transport: remoteTransport,
    } = await getCrossChainAccount(targetChain);
    const uo = calls.map(({ to, data = "0x", value }) => ({ target: to, data, value }));
    const [{ callGasLimit, maxFeePerGas, preVerificationGas, verificationGasLimit }, nativeBalance, balances, chains] =
      await Promise.all([
        buildUserOperation(
          createSmartAccountClient({
            chain: targetChain,
            transport: remoteTransport,
            account: remoteAccount,
            feeEstimator: alchemyFeeEstimator(alchemyTransport),
            dummyPaymasterAndData: alchemyGasManagerMiddleware(
              targetChain.id === chain.id ? alchemyGasPolicyId : sponsorPolicy(targetChain),
            ).dummyPaymasterAndData,
            gasEstimator,
          }),
          { uo: dataSuffix ? concatHex([await remoteAccount.encodeBatchExecute(uo), dataSuffix]) : uo },
        ) as Promise<Required<UserOperationStruct_v6>>,
        getBalance(rpc, { address: accountAddress }),
        targetChain.id === chain.id
          ? undefined
          : queryClient.ensureQueryData(balancesOptions(accountAddress)).then(
              (all) => all[targetChain.id],
              () => undefined,
            ),
        queryClient.ensureQueryData(lifiChainsOptions).catch(() => undefined),
      ]);
    const cost =
      (BigInt(callGasLimit) + BigInt(preVerificationGas) + BigInt(verificationGasLimit)) * BigInt(maxFeePerGas);
    const nativeToken = chains?.find(({ id }) => id === targetChain.id)?.nativeToken;
    const value = sum([0n, ...calls.map((call) => BigInt(call.value ?? 0))]);
    const unfunded = value > nativeBalance;
    if (targetChain.id === chain.id) {
      return {
        cost,
        payers: [],
        shortfall: unfunded && nativeToken ? { amount: value, native: true, token: nativeToken } : undefined,
      };
    }
    if (!spend) throw new Error("missing spend");
    const tokens = bridgePolicyTokens[targetChain.id] ?? [];
    const native = spend.token === zeroAddress;
    const source = tokens.includes(spend.token.toLowerCase()) ? spend.token : undefined;
    const gasToken = native
      ? undefined
      : (balances?.find(({ address }) => address.toLowerCase() === source?.toLowerCase()) ??
        balances?.find(
          ({ address, amount }) =>
            address !== nativeToken?.address && tokens.includes(address.toLowerCase()) && !!amount && amount > 0n,
        ));
    const nativeGasReserve = (cost * gasReserveBuffer) / 100n;
    const nativeCovered = value + nativeGasReserve <= nativeBalance;
    const paymasterAddress = getAlchemyPaymasterAddress(targetChain, "0.6.0");
    const nativeUsd = nativeToken && gasToken && nativeGasReserve > 0n ? parseAmount(nativeToken.priceUSD, 18) : 0n;
    const tokenUsd = nativeUsd > 0n && gasToken ? parseAmount(gasToken.priceUSD, 18) : 0n;
    const erc20GasReserve =
      nativeToken && gasToken && tokenUsd > 0n
        ? (nativeGasReserve * nativeUsd * 10n ** BigInt(gasToken.decimals)) /
          (tokenUsd * 10n ** BigInt(nativeToken.decimals))
        : 0n;
    const feeIsSource = !!gasToken && gasToken.address.toLowerCase() === source?.toLowerCase();
    const payable =
      gasToken &&
      erc20GasReserve > 0n &&
      (feeIsSource ? spend.amount + erc20GasReserve : erc20GasReserve) <= (gasToken.amount ?? 0n)
        ? gasToken
        : undefined;
    const sponsorable = !native && !feeIsSource;
    const allowance = payable
      ? await readContract(rpc, {
          address: getAddress(payable.address),
          abi: erc20Abi,
          functionName: "allowance",
          args: [accountAddress, paymasterAddress],
        }).catch(() => undefined)
      : undefined;
    const payers: Payer[] = [
      ...(nativeCovered ? [{}] : []),
      ...(payable && allowance !== undefined
        ? [
            {
              approvals: (allowance < erc20GasReserve ? (allowance > 0n ? [0n, maxUint256] : [maxUint256]) : []).map(
                (limit) => ({
                  target: getAddress(payable.address),
                  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [paymasterAddress, limit] }),
                }),
              ),
              policyId: [bridgePolicyId, sponsorPolicy(targetChain)],
              token: { address: getAddress(payable.address), maxTokenAmount: erc20GasReserve },
            },
          ]
        : []),
      ...(sponsorable || nativeCovered || payable
        ? [{ policyId: [alchemyGasPolicyId, sponsorPolicy(targetChain)] }]
        : []),
    ];
    return {
      cost,
      payers,
      shortfall:
        unfunded || (nativeGasReserve > 0n && !nativeCovered && !payable && !sponsorable)
          ? !unfunded && gasToken && feeIsSource && erc20GasReserve > 0n
            ? { amount: erc20GasReserve, native: false, token: gasToken }
            : nativeToken && { amount: value + nativeGasReserve, native: true, token: nativeToken }
          : undefined,
    };
  }
  const initCodes = new Map<number, Promise<Hex>>();
  function getAccountInitCode(rpc: typeof publicClient) {
    const cached = initCodes.get(rpc.chain.id);
    if (cached) return cached;
    const { address, abi } = getEntryPoint(rpc.chain);
    const promise = rpc
      .readContract({ address, abi, functionName: "getDepositInfo", args: [factory] })
      .then(async ({ staked }) => {
        if (staked) return concatHex([factory, accountInit({ x, y })]);
        if (!(await rpc.getCode({ address: factory }))) throw new DeploymentError("factory");
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (await rpc.getCode({ address: accountAddress })) return "0x";
        }
        throw new DeploymentError("account");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DeploymentError)) initCodes.delete(rpc.chain.id);
        throw error;
      });
    initCodes.set(rpc.chain.id, promise);
    return promise;
  }
  return createBundlerClient({
    chain,
    // @ts-expect-error bad alchemy types
    account,
    type: "SmartAccountClient",
    transport: noRetry({
      async request({ method, params }) {
        switch (method) {
          case "wallet_sendCalls": {
            if (!Array.isArray(params) || params.length !== 1) throw new Error("bad params");
            const { calls, capabilities, chainId, from, id } = params[0] as {
              calls: readonly Call[];
              capabilities?: ExtractCapabilities<"sendCalls", "Request"> & {
                dataSuffix?: { value?: unknown };
                retry?: () => void;
                spend?: Spend;
              };
              chainId?: Hex;
              from?: Address;
              id?: string;
            };
            if (from && from !== accountAddress) throw new Error("bad account");
            const targetChainId = chainId ? hexToNumber(chainId) : chain.id;
            const suffix = isHex(capabilities?.dataSuffix?.value) ? capabilities.dataSuffix.value : dataSuffix;
            const uo = calls.map(({ to, data = "0x", value }) => ({ from: accountAddress, target: to, data, value }));
            const execute = {
              to: accountAddress,
              functionName: "executeBatch",
              args: [calls.map(({ to, data = "0x", value = 0n }) => ({ target: to, data, value }))],
              abi: upgradeableModularAccountAbi,
            } as const;
            if (targetChainId !== chain.id) {
              const targetChain = alchemyChains.get(targetChainId);
              if (!targetChain) throw new Error(`unsupported chain ${targetChainId}`);
              const remote = await getCrossChainAccount(targetChain);
              const build = async ({ approvals = [], policyId: ids, token }: Payer) => {
                const batch = [...approvals, ...uo];
                const sender = createSmartAccountClient({
                  chain: targetChain,
                  transport: remote.transport,
                  account: remote.account,
                  feeEstimator: alchemyFeeEstimator(remote.alchemyTransport),
                  ...(ids
                    ? alchemyGasManagerMiddleware(ids, token)
                    : { opts: { feeOptions: { maxPriorityFeePerGas: { multiplier: 1.5 } } } }),
                  gasEstimator,
                });
                const operation = await sender.buildUserOperation({
                  uo: suffix ? concatHex([await remote.account.encodeBatchExecute(batch), suffix]) : batch,
                });
                return async () =>
                  sender.sendRawUserOperation(
                    await sender.signUserOperation({ uoStruct: operation }),
                    remote.account.getEntryPoint().address,
                  );
              };
              try {
                const { payers } = await plan(targetChain, calls, capabilities?.spend);
                let send: (() => Promise<Hex>) | undefined;
                let erc20 = false;
                for (const [index, payer] of payers.entries()) {
                  try {
                    send = await build(payer);
                    erc20 = !!payer.token;
                    break;
                  } catch (error) {
                    if (index === payers.length - 1 || !(payer.token ? denied(error) : rejected(error))) throw error;
                    reportError(error, { level: "warning" });
                  }
                }
                if (!send) throw new Error("no gas payer");
                const hash = await send().catch((error: unknown) => {
                  if (!erc20 || !denied(error) || (isSiwe() && delegable(error))) throw error;
                  reportError(error, { level: "warning" });
                });
                const receipt =
                  hash && erc20
                    ? await remote.readClient
                        .waitForUserOperationTransaction({
                          hash,
                          retries: { intervalMs: 1000, maxRetries: 60, multiplier: 1 },
                        })
                        .then(() => remote.readClient.getUserOperationReceipt(hash))
                        .catch(() => undefined)
                    : undefined;
                const sent =
                  hash && receipt?.success !== false
                    ? hash
                    : await build({ policyId: [alchemyGasPolicyId, sponsorPolicy(targetChain)] }).then((sponsored) => {
                        capabilities?.retry?.();
                        return sponsored();
                      });
                return { id: concat([sent, numberToHex(targetChainId, { size: 32 }), UO_MAGIC_ID]) };
              } catch (error) {
                if (!isSiwe() || !delegable(error) || !(await remote.account.isAccountDeployed())) throw error;
                reportError(error, { level: "warning", extra: { cause: error.cause } });
                return sendOwnerCalls({
                  chainId: targetChainId,
                  calls: [{ to: accountAddress, data: encodeFunctionData(execute), dataSuffix: suffix }],
                  experimental_fallback: true,
                });
              }
            }
            if (isSiwe() && (await account.isAccountDeployed())) {
              const sent = await sendOwnerCalls({
                id,
                chainId: chain.id,
                calls: [{ to: accountAddress, data: encodeFunctionData(execute) }],
                capabilities: {
                  ...(suffix ? { dataSuffix: { optional: true, ...capabilities?.dataSuffix, value: suffix } } : {}),
                  paymasterService: {
                    optional: true,
                    url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
                    context: { policyId: [alchemyGasPolicyId] },
                  },
                },
              });
              if (sent) return sent;
            }
            const { hash } = await client.sendUserOperation({
              uo: suffix ? concatHex([await account.encodeBatchExecute(uo), suffix]) : uo,
            });
            return { id: concat([hash, numberToHex(chain.id, { size: 32 }), UO_MAGIC_ID]) };
          }
          case "wallet_prepareCalls": {
            if (!Array.isArray(params) || params.length !== 1) throw new Error("bad params");
            const { calls, capabilities, chainId } = params[0] as {
              calls: readonly Call[];
              capabilities?: { spend?: Spend };
              chainId?: Hex;
            };
            const targetChainId = chainId ? hexToNumber(chainId) : chain.id;
            const targetChain = targetChainId === chain.id ? chain : alchemyChains.get(targetChainId);
            if (!targetChain) throw new Error(`unsupported chain ${targetChainId}`);
            const { cost, shortfall } = await plan(targetChain, calls, capabilities?.spend);
            return { chainId: numberToHex(targetChainId), cost, shortfall, type: "user-operation-v060" };
          }
          case "wallet_getCallsStatus": {
            if (!Array.isArray(params) || params.length !== 1 || typeof params[0] !== "string") throw new Error("bad");
            if (params[0].endsWith(UO_MAGIC_ID.slice(2)) && isHex(params[0]) && params[0].length === 194) {
              const uoChainId = hexToNumber(trim(sliceHex(params[0], -64, -32)));
              const uoClient = await getReadClient(uoChainId);
              const receipt = await uoClient.getUserOperationReceipt(sliceHex(params[0], 0, 32));
              return {
                version: "2.0.0",
                id: params[0],
                atomic: true,
                receipts: receipt ? [receipt.receipt] : [],
                status: receipt ? (receipt.success ? 200 : 500) : 100,
                chainId: uoChainId,
              };
            }
            if (params[0].endsWith(TX_MAGIC_ID.slice(2)) && isHex(params[0])) {
              const result = await viemGetCallsStatus(
                await getReadClient(hexToNumber(trim(sliceHex(params[0], -64, -32)))),
                { id: params[0] },
              );
              return { ...result, status: result.statusCode };
            }
            const result = await getCallsStatus(ownerConfig, { id: params[0] });
            return { ...result, status: result.statusCode };
          }
          case "wallet_getCapabilities":
            return Object.fromEntries(
              (Array.isArray(params) && Array.isArray(params[1]) ? (params[1] as unknown[]) : [numberToHex(chain.id)])
                .filter((id): id is Hex => isHex(id))
                .map((id) => [id, { dataSuffix: { supported: true } }]),
            );
          default:
            return client.request({ method: method as never, params: params as never });
        }
      },
    }),
  }).extend(smartAccountClientActions) as unknown as typeof client;
}

function noRetry(provider: Parameters<typeof custom>[0]) {
  return custom(provider, { retryCount: 0 });
}

function wrapSignature(ownerIndex: number, signature: Hex) {
  return encodePacked(["uint8", "bytes"], [ownerIndex, signature]);
}

function dummySignature(challenge: string) {
  return webauthn({
    authenticatorData: "0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97630500000000",
    clientDataJSON: `{"type":"webauthn.get","challenge":"${challenge}","origin":"${
      Platform.OS === "android"
        ? `android:apk-key-hash:${"A".repeat(43)}`
        : Platform.OS === "web" && typeof window !== "undefined"
          ? window.location.origin
          : `https://${domain}`
    }"${Platform.OS === "ios" ? "" : ',"crossOrigin":false'}}`,
    typeIndex: 1n,
    challengeIndex: 23n,
    r: maxUint256,
    s: P256_N / 2n,
  });
}

async function gasEstimator<
  TAccount extends SmartContractAccount,
  C extends MiddlewareClient,
  TEntryPointVersion extends GetEntryPointFromAccount<TAccount> = GetEntryPointFromAccount<TAccount>,
>(
  userOp: Deferrable<UserOperationStruct<TEntryPointVersion>>,
  context: ClientMiddlewareArgs<TAccount, C, undefined | UserOperationContext, TEntryPointVersion>,
): Promise<Deferrable<UserOperationStruct<TEntryPointVersion>>> {
  const result = await defaultGasEstimator(context.client)(userOp, context);
  if (isSiwe()) return result;
  const limit = BigInt((await result.verificationGasLimit) ?? 0);
  if (!limit) throw new Error("missing verification gas limit");
  result.verificationGasLimit = limit + 10_000n;
  return result;
}

function sponsorPolicy(targetChain: Chain) {
  return targetChain.testnet ? "dc767b7d-9ce8-4512-ba67-ebe2cf7a1577" : "cb9db554-658f-46eb-ae73-8bff8ed2556b";
}

function isSiwe() {
  return queryClient.getQueryData<AuthMethod>(["method"]) === "siwe";
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

export async function estimateCalls(config: Config, chainId: number, calls: readonly Call[], spend?: Spend) {
  const client = await getConnectorClient(config);
  return client.request<{
    ReturnType: { cost: bigint; shortfall?: { amount: bigint; native: boolean; token: Token } };
  }>({
    method: "wallet_prepareCalls",
    params: [
      {
        calls: calls.map((call) => ({
          ...call,
          value: call.value === undefined ? undefined : numberToHex(call.value),
        })),
        chainId: numberToHex(chainId),
        ...(spend && { capabilities: { spend } }),
      },
    ],
  });
}

function delegable(error: unknown): error is BaseError {
  return (
    error instanceof BaseError &&
    !!error.walk((cause) => cause instanceof RpcRequestError && [-32_502, -32_507].includes(cause.code))
  );
}

function rejected(error: unknown) {
  return error instanceof BaseError && !!error.walk((cause) => cause instanceof RpcRequestError);
}

function denied(error: unknown) {
  const { authKnown, network } = classifyError(error);
  return !authKnown && network === undefined;
}

type Remote = {
  account: SmartContractAccount;
  alchemyTransport: ReturnType<typeof alchemy>;
  readClient: SmartAccountClient<Transport, Chain, SmartContractAccount>;
  rpc: ReturnType<typeof createAlchemyPublicRpcClient>;
  transport: Transport;
};

type Payer = {
  approvals?: { data: Hex; target: Address }[];
  policyId?: string[];
  token?: { address: Address; maxTokenAmount: bigint };
};

export async function callsStatus(config: Config, id: string, chainId?: number) {
  try {
    const bundle =
      isHex(id) && chainId !== undefined ? concat([id, numberToHex(chainId, { size: 32 }), TX_MAGIC_ID]) : id;
    if (isHex(bundle) && bundle.endsWith(TX_MAGIC_ID.slice(2))) {
      let reason: string | undefined;
      const receipt = await waitForTransactionReceipt(config, {
        hash: sliceHex(bundle, 0, -64),
        chainId: hexToNumber(trim(sliceHex(bundle, -64, -32))),
        onReplaced: (replacement) => (reason = replacement.reason),
      });
      if (receipt.status === "reverted" || reason === "cancelled" || reason === "replaced") return "failure";
      return "success";
    }
    const { status } = await waitForCallsStatus(config, { id: bundle });
    return status;
  } catch (error) {
    reportError(error, { level: "warning" });
    return "unknown";
  }
}

const unsupported = new Map<string, BaseError>();

type OwnerCalls = SendCallsParameters<
  typeof ownerConfig,
  (typeof ownerConfig)["chains"][number]["id"],
  readonly { data?: Hex; dataSuffix?: Hex; to: Address; value?: bigint }[]
>;

export async function sendOwnerCalls(parameters: OwnerCalls & { experimental_fallback: true }): Promise<{ id: string }>;
export async function sendOwnerCalls(parameters: OwnerCalls): Promise<undefined | { id: string }>;
export async function sendOwnerCalls({ chainId = chain.id, experimental_fallback, ...parameters }: OwnerCalls) {
  if (getConnection(ownerConfig).chainId !== chainId) await switchChain(ownerConfig, { chainId });
  const key = `${getConnection(ownerConfig).connector?.uid}:${chainId}`;
  try {
    const remembered = unsupported.get(key);
    if (remembered) throw remembered;
    return await sendCalls(ownerConfig, { ...parameters, chainId });
  } catch (error) {
    if (
      !(error instanceof BaseError) ||
      error.walk((cause) => cause instanceof UnknownRpcError) ||
      !(await viemSendCalls(
        createClient({
          chain,
          transport: custom({
            request: (args: { method: string }) =>
              args.method === "wallet_sendCalls"
                ? Promise.reject(error.walk())
                : Promise.resolve(numberToHex(chain.id)),
          }),
        }),
        {
          account: zeroAddress,
          calls: parameters.calls.map(() => ({ to: zeroAddress })),
          capabilities: parameters.capabilities,
          forceAtomic: parameters.forceAtomic,
          experimental_fallback: true,
          experimental_fallbackDelay: 0,
        },
      ).then(
        () => true,
        () => false,
      ))
    ) {
      throw error;
    }
    if (!unsupported.has(key)) reportError(error, { level: "warning", extra: { cause: error.cause } });
    if (error.walk((cause) => cause instanceof MethodNotFoundRpcError || cause instanceof MethodNotSupportedRpcError)) {
      unsupported.set(key, error);
    }
  }
  if (!experimental_fallback) return;
  let hash: Hex | undefined;
  for (const { data, dataSuffix: suffix, to, value } of parameters.calls) {
    if (hash && (await callsStatus(ownerConfig, hash, chainId)) !== "success") throw new Error("transaction failed");
    const client = await getConnectorClient(ownerConfig, { chainId });
    hash = await signTransaction(client, { to, value, data: suffix ? concat([data ?? "0x", suffix]) : data }).then(
      (signed) => {
        let serializedTransaction = signed;
        try {
          const { r, s, v, ...transaction } = parseTransaction(signed); // eslint-disable-line @typescript-eslint/no-deprecated -- legacy transactions sign with v
          if (r && s && v !== undefined) serializedTransaction = serializeTransaction(transaction, { r, s, v });
        } catch {} // eslint-disable-line no-empty -- chain specific transaction types go out as the wallet signed them
        return sendRawTransaction(client, { serializedTransaction });
      },
      (error: unknown) => {
        if (classifyError(error).walletRejected) throw error;
        return sendTransaction(ownerConfig, { chainId, to, data, dataSuffix: suffix, value });
      },
    );
  }
  if (!hash) throw new Error("no calls");
  return { id: concat([hash, numberToHex(chainId, { size: 32 }), TX_MAGIC_ID]) };
}

export class DeploymentError extends Error {
  missing: "account" | "factory";
  constructor(missing: "account" | "factory") {
    super(`${missing} not deployed`);
    this.missing = missing;
    this.name = "DeploymentError";
  }
}
