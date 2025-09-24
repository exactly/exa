import { getAddress } from "viem";
import { useAccount as useWagmiAccount } from "wagmi"; // eslint-disable-line no-restricted-imports

export default function useAccount() {
  const account = useWagmiAccount();
  return process.env.EXPO_PUBLIC_IMPERSONATE
    ? { ...account, address: account.address && getAddress(process.env.EXPO_PUBLIC_IMPERSONATE) }
    : account;
}
