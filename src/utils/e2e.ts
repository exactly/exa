import chain from "@exactly/common/generated/chain";
import { createWalletClient, http, isHex, type EIP1193Provider, type EIP1193RequestFn } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const account =
  typeof window !== "undefined" && process.env.EXPO_PUBLIC_ENV === "e2e"
    ? mnemonicToAccount("test test test test test test test test test test test junk")
    : undefined;

if (account) {
  window.ethereum = {
    request: (async ({ method, params }) => {
      switch (method) {
        case "eth_chainId":
          return chain.id.toString();
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
        default:
          throw new Error(`${method} not supported`);
      }
    }) as EIP1193RequestFn,
    on: () => undefined,
    removeListener: () => undefined,
  };
}

export default account && createWalletClient({ chain, account, transport: http() });

declare global {
  interface Window {
    ethereum: EIP1193Provider;
  }
}
