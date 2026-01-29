import { Platform } from "react-native";

import { useMutation } from "@tanstack/react-query";
import {
  concat,
  createWalletClient,
  hexToNumber,
  http,
  isHex,
  numberToHex,
  sliceHex,
  trim,
  type EIP1193Provider,
  type EIP1193RequestFn,
  type WalletSendCallsParameters,
} from "viem";
import { mnemonicToAccount, nonceManager } from "viem/accounts";

import chain from "@exactly/common/generated/chain";

import publicClient from "./publicClient";

const account =
  typeof window !== "undefined" && process.env.EXPO_PUBLIC_ENV === "e2e"
    ? mnemonicToAccount(
        process.env.EXPO_PUBLIC_E2E_MNEMONIC || "test test test test test test test test test test test junk", // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
        { nonceManager },
      )
    : undefined;
const client = account && createWalletClient({ chain, account, transport: http() });
export default client;

const TX_MAGIC_ID = "0x5792579257925792579257925792579257925792579257925792579257925792";

if (client) {
  window.ethereum = {
    request: (async ({ method, params }) => {
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
          const [{ from, calls }] = params as WalletSendCallsParameters;
          if (from && from !== account.address) throw new Error("bad account");
          const hashes = await Promise.all(
            calls.map(({ to, data, value }) =>
              client.sendTransaction({ to, data, value: value && BigInt(value), gas: 6_666_666n }),
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
      client
        ? fetch(`http://localhost:3000/e2e/coverage?platform=${Platform.OS}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(__coverage__),
          })
        : Promise.resolve(null),
  });
}

declare const __coverage__: unknown;
declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    ethereum: EIP1193Provider;
  }
}
