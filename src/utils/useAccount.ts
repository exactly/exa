import { getAddress } from "viem";
import { useAccount as useWagmiAccount, type UseAccountParameters } from "wagmi"; // eslint-disable-line no-restricted-imports

export default function useAccount(parameters?: UseAccountParameters) {
  const account = useWagmiAccount(parameters);
  return !parameters?.config && process.env.EXPO_PUBLIC_IMPERSONATE
    ? { ...account, address: account.address && getAddress(process.env.EXPO_PUBLIC_IMPERSONATE) }
    : account;
}
