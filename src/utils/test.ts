import chain from "@exactly/common/generated/chain";
import type { EIP1193Provider, EIP1193RequestFn } from "viem";
import { mnemonicToAccount } from "viem/accounts";
if (typeof window !== "undefined" && process.env.EXPO_PUBLIC_ENV === "test") {
  const account = mnemonicToAccount(
    "test test test test test test test test test test test junk", // test only
  );
  console.log("account", account.address);
  window.ethereum = {
    on(...arguments_: Parameters<EIP1193Provider["on"]>) {
      // noop
      console.log("on", ...arguments_);
    },
    removeListener(...arguments_: Parameters<EIP1193Provider["removeListener"]>) {
      // noop
      console.log("removeListener", ...arguments_);
    },
    request: (async ({ method, params }) => {
      console.log(JSON.stringify({ method, params }, null, 2));
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
          if (!Array.isArray(params) || params.length !== 2) throw new Error("bad params");
          if (params[1] !== account.address) throw new Error("bad account");
          return account.signMessage({ message: { raw: params[0] as `0x${string}` } });
        default:
          throw new Error(`${method} not supported`);
      }
    }) as EIP1193RequestFn,
  } satisfies EIP1193Provider;
}

declare global {
  interface Window {
    ethereum: EIP1193Provider;
  }
}
