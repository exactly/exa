import "viem/window";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { useMutation } from "@tanstack/react-query";
import {
  concat,
  createTestClient,
  createWalletClient,
  hexToNumber,
  http,
  isHex,
  numberToHex,
  sliceHex,
  trim,
  type EIP1193RequestFn,
  type WalletSendCallsParameters,
} from "viem";
import { generatePrivateKey, nonceManager, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

import { dataSuffix } from "@exactly/common/attribution";
import chain from "@exactly/common/generated/chain";

import publicClient from "./publicClient";

const e2e = process.env.EXPO_PUBLIC_ENV === "e2e";
export default e2e;

const TX_MAGIC_ID = "0x5792579257925792579257925792579257925792579257925792579257925792";

let client: ReturnType<typeof walletClient> | undefined;
if (Platform.OS !== "web" && e2e && !window.ethereum) {
  window.ethereum = {
    request: (async ({ method, params }) => {
      client ??= walletClient().catch(resetClient);
      const { account, sendTransaction } = await client;
      switch (method) {
        case "eth_chainId":
          return String(chain.id);
        case "eth_accounts":
        case "eth_requestAccounts":
          return [account.address];
        case "wallet_switchEthereumChain":
          if (!Array.isArray(params) || params.length !== 1) throw new Error("bad params");
          return { result: null };
        case "personal_sign":
          if (!Array.isArray(params) || params.length !== 2 || !isHex(params[0])) throw new Error("bad params");
          if (params[1] !== account.address) throw new Error("bad account");
          return account.signMessage({ message: { raw: params[0] } });
        case "wallet_sendCalls": {
          if (!Array.isArray(params) || params.length !== 1) throw new Error("bad params");
          const [{ calls, capabilities, from }] = params as WalletSendCallsParameters;
          if (from && from !== account.address) throw new Error("bad account");
          const attribution = (capabilities as undefined | { dataSuffix?: { value?: unknown } })?.dataSuffix?.value;
          const suffix = isHex(attribution) ? attribution : dataSuffix;
          const hashes = await Promise.all(
            calls.map(({ to, data, value }) =>
              sendTransaction({ to, data, dataSuffix: suffix, value: value && BigInt(value), gas: 6_666_666n }),
            ),
          );
          return { id: concat([...hashes, numberToHex(chain.id, { size: 32 }), TX_MAGIC_ID]) };
        }
        case "wallet_getCallsStatus": {
          if (!Array.isArray(params) || params.length !== 1 || !isHex(params[0])) throw new Error("bad");
          const [id] = params;
          const receipts = await Promise.all(
            Array.from({ length: (id.length - 2) / 2 / 32 - 2 }, (_, index) =>
              publicClient.getTransactionReceipt({ hash: sliceHex(id, index * 32, (index + 1) * 32) }),
            ),
          );
          return {
            version: "2.0.0",
            id,
            atomic: true,
            receipts,
            status: receipts.every((r) => r.status === "success") ? 200 : 500,
            chainId: hexToNumber(trim(sliceHex(id, -64, -32))),
          };
        }
        default:
          throw new Error(`${method} not supported`);
      }
    }) as EIP1193RequestFn,
    on: () => undefined,
    removeListener: () => undefined,
  };
}

export function useSubmitCoverage() {
  return useMutation({
    mutationFn: () =>
      e2e
        ? fetch(`http://localhost:3000/e2e/coverage?platform=${Platform.OS}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(__coverage__),
          })
        : Promise.resolve(null),
  });
}

async function walletClient() {
  const stored = await AsyncStorage.getItem("e2e.wallet");
  const key = isHex(stored) ? stored : generatePrivateKey();
  const account = privateKeyToAccount(key, { nonceManager });
  if (key !== stored) await AsyncStorage.setItem("e2e.wallet", key);
  if (chain.id === anvil.id && (await publicClient.getBalance({ address: account.address })) === 0n) {
    await createTestClient({ chain, mode: "anvil", transport: http() }).setBalance({
      address: account.address,
      value: 10n ** 22n,
    });
  }
  return createWalletClient({ chain, account, transport: http(), dataSuffix });
}

function resetClient(error: unknown): never {
  client = undefined;
  throw error;
}

declare const __coverage__: unknown;
