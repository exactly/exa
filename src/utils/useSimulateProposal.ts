import { encodeAbiParameters, encodeFunctionData, multicall3Abi, zeroAddress, type Address, type Hex } from "viem";
import { useReadContracts, type UseWriteContractReturnType } from "wagmi";

import chain, { exaPreviewerAddress, proposalManagerAddress } from "@exactly/common/generated/chain";
import {
  auditorAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  useReadExaPluginPluginMetadata,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";

import useSimulateBlocks from "./wagmi/useSimulateBlocks";

export default function useSimulateProposal({
  account,
  amount,
  chain: {
    contracts: {
      multicall3: { address: multicall3Address },
    },
  } = chain,
  enabled = true,
  market,
  ...proposal
}: {
  account: Address | undefined;
  amount: bigint | undefined;
  chain?: { contracts: { multicall3: { address: Address } } };
  enabled?: boolean;
  market: Address | undefined;
} & (
  | {
      assetOut: Address | undefined;
      minAmountOut: bigint | undefined;
      proposalType: typeof ProposalType.Swap;
      route: Hex | undefined;
    }
  | {
      borrowMaturity: bigint | undefined;
      maxRepayAssets: bigint | undefined;
      percentage: bigint | undefined;
      proposalType: typeof ProposalType.RollDebt;
      repayMaturity: bigint | undefined;
    }
  | {
      marketOut: Address | undefined;
      maturity: bigint | undefined;
      maxRepay: bigint | undefined;
      positionAssets: bigint | undefined;
      proposalType: typeof ProposalType.CrossRepayAtMaturity;
      route: Hex | undefined;
    }
  | {
      maturity: bigint | undefined;
      maxAssets: bigint | undefined;
      proposalType: typeof ProposalType.BorrowAtMaturity;
      receiver: Address | undefined;
    }
  | {
      maturity: bigint | undefined;
      positionAssets: bigint | undefined;
      proposalType: typeof ProposalType.RepayAtMaturity;
    }
  | { proposalType: typeof ProposalType.Redeem; receiver: Address | undefined }
  | { proposalType: typeof ProposalType.Withdraw; receiver: Address | undefined }
)) {
  const { data: reads } = useReadContracts({
    contracts: [
      { address: account, abi: upgradeableModularAccountAbi, functionName: "getInstalledPlugins" },
      { address: proposalManagerAddress, abi: proposalManagerAbi, functionName: "delay" },
      {
        address: proposalManagerAddress,
        abi: proposalManagerAbi,
        functionName: "queueNonces",
        args: account ? [account] : undefined,
      },
      { address: multicall3Address, abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" },
      {
        address: multicall3Address,
        abi: [
          {
            type: "function",
            name: "getBlockNumber",
            inputs: [],
            outputs: [{ type: "uint256" }],
            stateMutability: "view",
          },
        ],
        functionName: "getBlockNumber",
      },
      { address: exaPreviewerAddress, abi: exaPreviewerAbi, functionName: "assets" },
    ] as const,
    allowFailure: true,
    query: { enabled: enabled && !!account },
  });
  const [plugins, delay, nonce, timestamp, blockNumber, assets] = reads ?? [];
  const installedPlugins = plugins?.status === "success" ? plugins.result : undefined;
  const { data: pluginMetadata } = useReadExaPluginPluginMetadata({
    address: installedPlugins?.[0],
    query: { enabled: !!installedPlugins?.[0] },
  });
  const proposalData =
    proposal.proposalType === ProposalType.BorrowAtMaturity
      ? encodeBorrowAtMaturity(proposal)
      : proposal.proposalType === ProposalType.CrossRepayAtMaturity
        ? pluginMetadata?.version === undefined
          ? undefined
          : encodeCrossRepayAtMaturity({
              ...proposal,
              marketOut: pluginMetadata.version >= "1.1.0" ? proposal.marketOut : undefined,
            })
        : proposal.proposalType === ProposalType.RepayAtMaturity
          ? encodeRepayAtMaturity(proposal)
          : proposal.proposalType === ProposalType.RollDebt
            ? encodeRollDebt(proposal)
            : proposal.proposalType === ProposalType.Swap
              ? encodeSwap(proposal)
              : encodeAddress(proposal.receiver);
  const legacyAsset =
    market === undefined || assets?.status !== "success"
      ? undefined
      : assets.result.find(({ market: assetMarket }) => assetMarket === market)?.asset;
  const request =
    account === undefined
      ? undefined
      : proposal.proposalType === ProposalType.Withdraw &&
          pluginMetadata?.version !== undefined &&
          pluginMetadata.version < "0.0.4"
        ? legacyAsset === undefined ||
          legacyAsset === zeroAddress ||
          amount === undefined ||
          proposal.receiver === undefined
          ? undefined
          : {
              account,
              address: account,
              abi: legacyProposeAbi,
              functionName: "propose" as const,
              args: [legacyAsset, amount, proposal.receiver] as const,
            }
        : market === undefined ||
            market === zeroAddress ||
            amount === undefined ||
            proposalData === undefined ||
            (proposal.proposalType === ProposalType.Withdraw && pluginMetadata?.version === undefined)
          ? undefined
          : {
              account,
              address: account,
              abi: proposeAbi,
              functionName: "propose" as const,
              args: [market, amount, proposal.proposalType, proposalData] as const,
            };
  const executeRequest =
    account === undefined || nonce?.status !== "success"
      ? undefined
      : {
          account,
          address: account,
          abi: executeProposalAbi,
          functionName: "executeProposal" as const,
          args: [nonce.result] as const,
        };
  const simulation = useSimulateBlocks({
    blockNumber: blockNumber?.status === "success" ? blockNumber.result : undefined,
    blocks: [
      {
        blockOverrides: timestamp?.status === "success" ? { time: timestamp.result } : undefined,
        calls: request
          ? [
              {
                account: request.account,
                to: request.address,
                data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }),
              },
            ]
          : [],
      },
      {
        blockOverrides:
          timestamp?.status === "success" && delay?.status === "success"
            ? { time: timestamp.result + delay.result }
            : undefined,
        calls: executeRequest
          ? [
              {
                account: executeRequest.account,
                to: executeRequest.address,
                data: encodeFunctionData({
                  abi: executeRequest.abi,
                  functionName: executeRequest.functionName,
                  args: executeRequest.args,
                }),
              },
            ]
          : [],
      },
    ],
    chainId: chain.id,
    query: {
      enabled:
        enabled &&
        installedPlugins !== undefined &&
        request !== undefined &&
        executeRequest !== undefined &&
        delay?.status === "success" &&
        timestamp?.status === "success" &&
        blockNumber?.status === "success",
    },
  });
  const propose = simulation.data?.[0]?.calls[0];
  const execute = simulation.data?.[1]?.calls[0];
  return {
    request:
      propose?.status === "success" && execute?.status === "success"
        ? (request as Parameters<UseWriteContractReturnType["mutate"]>[0])
        : undefined,
    isPending: simulation.isPending,
    error:
      simulation.error ??
      (propose?.status === "failure" ? propose.error : null) ??
      (execute?.status === "failure" ? execute.error : null),
  };
}

function encodeBorrowAtMaturity({
  maturity,
  maxAssets,
  receiver,
}: {
  maturity: bigint | undefined;
  maxAssets: bigint | undefined;
  receiver: Address | undefined;
}) {
  return maturity === undefined || maxAssets === undefined || receiver === undefined
    ? undefined
    : encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "maturity", type: "uint256" },
              { name: "maxAssets", type: "uint256" },
              { name: "receiver", type: "address" },
            ],
          },
        ],
        [{ maturity, maxAssets, receiver }],
      );
}

function encodeCrossRepayAtMaturity({
  marketOut,
  maturity,
  maxRepay,
  positionAssets,
  route,
}: {
  marketOut?: Address;
  maturity: bigint | undefined;
  maxRepay: bigint | undefined;
  positionAssets: bigint | undefined;
  route: Hex | undefined;
}) {
  if (maturity === undefined || positionAssets === undefined || maxRepay === undefined || route === undefined) return;
  return marketOut === undefined
    ? encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "maturity", type: "uint256" },
              { name: "positionAssets", type: "uint256" },
              { name: "maxRepay", type: "uint256" },
              { name: "route", type: "bytes" },
            ],
          },
        ],
        [{ maturity, positionAssets, maxRepay, route }],
      )
    : encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "maturity", type: "uint256" },
              { name: "positionAssets", type: "uint256" },
              { name: "marketOut", type: "address" },
              { name: "maxRepay", type: "uint256" },
              { name: "route", type: "bytes" },
            ],
          },
        ],
        [{ maturity, positionAssets, marketOut, maxRepay, route }],
      );
}

function encodeRepayAtMaturity({
  maturity,
  positionAssets,
}: {
  maturity: bigint | undefined;
  positionAssets: bigint | undefined;
}) {
  return maturity === undefined || positionAssets === undefined
    ? undefined
    : encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "maturity", type: "uint256" },
              { name: "positionAssets", type: "uint256" },
            ],
          },
        ],
        [{ maturity, positionAssets }],
      );
}

function encodeRollDebt({
  borrowMaturity,
  maxRepayAssets,
  percentage,
  repayMaturity,
}: {
  borrowMaturity: bigint | undefined;
  maxRepayAssets: bigint | undefined;
  percentage: bigint | undefined;
  repayMaturity: bigint | undefined;
}) {
  return repayMaturity === undefined ||
    borrowMaturity === undefined ||
    maxRepayAssets === undefined ||
    percentage === undefined
    ? undefined
    : encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "repayMaturity", type: "uint256" },
              { name: "borrowMaturity", type: "uint256" },
              { name: "maxRepayAssets", type: "uint256" },
              { name: "percentage", type: "uint256" },
            ],
          },
        ],
        [{ repayMaturity, borrowMaturity, maxRepayAssets, percentage }],
      );
}

function encodeSwap({
  assetOut,
  minAmountOut,
  route,
}: {
  assetOut: Address | undefined;
  minAmountOut: bigint | undefined;
  route: Hex | undefined;
}) {
  return assetOut === undefined || minAmountOut === undefined || route === undefined
    ? undefined
    : encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "assetOut", type: "address" },
              { name: "minAmountOut", type: "uint256" },
              { name: "route", type: "bytes" },
            ],
          },
        ],
        [{ assetOut, minAmountOut, route }],
      );
}

function encodeAddress(receiver: Address | undefined) {
  return receiver && encodeAbiParameters([{ type: "address" }], [receiver]);
}

const proposeAbi = [...upgradeableModularAccountAbi, ...exaPluginAbi, ...proposalManagerAbi];
const legacyProposeAbi = [
  ...upgradeableModularAccountAbi,
  {
    type: "function",
    name: "propose",
    inputs: [
      { internalType: "contract IMarket", name: "market", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "address", name: "receiver", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
const executeProposalAbi = [
  ...upgradeableModularAccountAbi,
  ...exaPluginAbi,
  ...proposalManagerAbi,
  ...auditorAbi,
  ...marketAbi,
];
