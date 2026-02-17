import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import {
  simulateBlocks,
  type SimulateBlocksErrorType,
  type SimulateBlocksParameters,
  type SimulateBlocksReturnType,
} from "viem/actions";
import { useChainId, useConfig, type Config } from "wagmi";
import { hashFn, structuralSharing } from "wagmi/query";

type QueryOptions<calls extends readonly unknown[]> = Omit<
  UseQueryOptions<SimulateBlocksReturnType<calls>, SimulateBlocksErrorType, SimulateBlocksReturnType<calls>>,
  "queryFn" | "queryKey" | "queryKeyHashFn"
>;

export default function useSimulateBlocks<const calls extends readonly unknown[]>({
  config: configParameter,
  chainId: chainIdParameter,
  query,
  ...parameters
}: SimulateBlocksParameters<calls> & { chainId?: number; config?: Config; query?: QueryOptions<calls> }) {
  const config = useConfig({ config: configParameter });
  const chainId = useChainId({ config });
  const resolvedChainId = chainIdParameter ?? chainId;
  return useQuery({
    ...query,
    queryKey: ["simulateBlocks", { chainId: resolvedChainId, ...parameters }],
    queryKeyHashFn: hashFn,
    structuralSharing,
    enabled: query?.enabled ?? true,
    queryFn: () => simulateBlocks(config.getClient({ chainId: resolvedChainId }), parameters),
  });
}
