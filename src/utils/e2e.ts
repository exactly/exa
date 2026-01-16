import { Platform } from "react-native";

import { useMutation } from "@tanstack/react-query";
import {
  createWalletClient,
  hexToBigInt,
  http,
  isHex,
  type EIP1193Provider,
  type EIP1193RequestFn,
  type WalletSendCallsParameters,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

import chain from "@exactly/common/generated/chain";

const account =
  typeof window !== "undefined" && process.env.EXPO_PUBLIC_ENV === "e2e"
    ? mnemonicToAccount(
        process.env.EXPO_PUBLIC_E2E_MNEMONIC || "test test test test test test test test test test test junk", // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
      )
    : undefined;
const client = account && createWalletClient({ chain, account, transport: http() });
export default client;

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
          for (const { to, data, value } of calls) {
            client
              .sendTransaction({ to, data, value: value && hexToBigInt(value), gas: 6_666_666n })
              .then(console.log) // eslint-disable-line no-console
              .catch(console.error); // eslint-disable-line no-console
          }
          return { result: null };
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
