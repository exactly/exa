import { getAddress, zeroAddress } from "viem";
import { useConnection, type UseConnectionParameters } from "wagmi";

export default function useAccount(parameters?: UseConnectionParameters) {
  const connection = useConnection(parameters);
  if (connection.address === zeroAddress) return { ...connection, address: undefined, isConnected: false };
  return !parameters?.config && process.env.EXPO_PUBLIC_IMPERSONATE
    ? { ...connection, address: connection.address && getAddress(process.env.EXPO_PUBLIC_IMPERSONATE) }
    : connection;
}
