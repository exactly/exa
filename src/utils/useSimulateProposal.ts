import { useMemo } from "react";

import { encodeAbiParameters, encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { useBytecode } from "wagmi";

import { proposalManagerAddress } from "@exactly/common/generated/chain";
import {
  auditorAbi,
  exaPluginAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  useReadProposalManagerDelay,
  useReadProposalManagerQueueNonces,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";

import useSimulateBlocks from "./wagmi/useSimulateBlocks";

export default function useSimulateProposal({
  account,
  amount,
  market,
  enabled = true,
  ...proposal
}: {
  account: Address | undefined;
  amount: bigint | undefined;
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
      maturity: bigint | undefined;
      maxAssets: bigint | undefined;
      proposalType: typeof ProposalType.BorrowAtMaturity;
      receiver: Address | undefined;
    }
  | {
      maturity: bigint | undefined;
      maxRepay: bigint | undefined;
      positionAssets: bigint | undefined;
      proposalType: typeof ProposalType.CrossRepayAtMaturity;
      route: Hex | undefined;
    }
  | {
      maturity: bigint | undefined;
      positionAssets: bigint | undefined;
      proposalType: typeof ProposalType.RepayAtMaturity;
    }
  | {
      proposalType: typeof ProposalType.Redeem;
      receiver: Address | undefined;
    }
  | {
      proposalType: typeof ProposalType.Withdraw;
      receiver: Address | undefined;
    }
)) {
  const proposalData =
    proposal.proposalType === ProposalType.BorrowAtMaturity
      ? proposal.maturity === undefined || proposal.maxAssets === undefined || proposal.receiver === undefined
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
            [{ maturity: proposal.maturity, maxAssets: proposal.maxAssets, receiver: proposal.receiver }],
          )
      : proposal.proposalType === ProposalType.CrossRepayAtMaturity
        ? proposal.maturity === undefined ||
          proposal.positionAssets === undefined ||
          proposal.maxRepay === undefined ||
          proposal.route === undefined
          ? undefined
          : encodeAbiParameters(
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
              [
                {
                  maturity: proposal.maturity,
                  positionAssets: proposal.positionAssets,
                  maxRepay: proposal.maxRepay,
                  route: proposal.route,
                },
              ],
            )
        : proposal.proposalType === ProposalType.RepayAtMaturity
          ? proposal.maturity === undefined || proposal.positionAssets === undefined
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
                [{ maturity: proposal.maturity, positionAssets: proposal.positionAssets }],
              )
          : proposal.proposalType === ProposalType.RollDebt
            ? proposal.repayMaturity === undefined ||
              proposal.borrowMaturity === undefined ||
              proposal.maxRepayAssets === undefined ||
              proposal.percentage === undefined
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
                  [
                    {
                      repayMaturity: proposal.repayMaturity,
                      borrowMaturity: proposal.borrowMaturity,
                      maxRepayAssets: proposal.maxRepayAssets,
                      percentage: proposal.percentage,
                    },
                  ],
                )
            : proposal.proposalType === ProposalType.Swap
              ? proposal.assetOut === undefined || proposal.minAmountOut === undefined || proposal.route === undefined
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
                    [{ assetOut: proposal.assetOut, minAmountOut: proposal.minAmountOut, route: proposal.route }],
                  )
              : proposal.receiver && encodeAbiParameters([{ type: "address" }], [proposal.receiver]);
  const { data: deployed } = useBytecode({ address: account ?? zeroAddress, query: { enabled: enabled && !!account } });
  const proposalArguments = useMemo(
    () => [market ?? zeroAddress, amount ?? 0n, proposal.proposalType, proposalData ?? "0x"] as const,
    [amount, market, proposal.proposalType, proposalData],
  );
  const proposeRequest = useMemo(
    () =>
      account === undefined
        ? undefined
        : ({
            account,
            address: account,
            abi: proposeAbi,
            functionName: "propose",
            args: proposalArguments,
          } as const),
    [account, proposalArguments],
  );
  const proposeCalldata = useMemo(
    () => encodeFunctionData({ abi: proposeAbi, functionName: "propose", args: proposalArguments }),
    [proposalArguments],
  );
  const { data: proposalDelay } = useReadProposalManagerDelay({ address: proposalManagerAddress, query: { enabled } });
  const { data: nonce } = useReadProposalManagerQueueNonces({
    address: proposalManagerAddress,
    args: account ? [account] : undefined,
    query: { enabled: enabled && !!account },
  });
  const executeArguments = useMemo(() => [nonce ?? 0n] as const, [nonce]);
  const executeRequest = useMemo(
    () =>
      account === undefined
        ? undefined
        : ({
            account,
            address: account,
            abi: executeProposalAbi,
            functionName: "executeProposal",
            args: executeArguments,
          } as const),
    [account, executeArguments],
  );
  const executeCalldata = useMemo(
    () => encodeFunctionData({ abi: executeProposalAbi, functionName: "executeProposal", args: executeArguments }),
    [executeArguments],
  );
  const simulationTime = useMemo(
    () => (proposalDelay === undefined ? undefined : BigInt(Math.floor(Date.now() / 1000)) + proposalDelay),
    [account, amount, market, nonce, proposal.proposalType, proposalData, proposalDelay],
  );
  const simulation = useSimulateBlocks({
    blocks: [
      { calls: [{ account, to: account ?? zeroAddress, data: proposeCalldata }] },
      {
        blockOverrides: simulationTime === undefined ? undefined : { time: simulationTime },
        calls: [{ account, to: account ?? zeroAddress, data: executeCalldata }],
      },
    ],
    query: {
      enabled: enabled && !!deployed && !!account && !!amount && nonce !== undefined && simulationTime !== undefined,
    },
  });
  const proposeCall = simulation.data?.[0]?.calls[0] as CallResult | undefined;
  const executeCall = simulation.data?.[1]?.calls[0] as CallResult | undefined;
  const propose = {
    ...simulation,
    data:
      proposeCall?.status === "success" && proposeRequest
        ? { request: proposeRequest, result: proposeCall.result }
        : undefined,
    error: simulation.error ?? (proposeCall?.status === "failure" ? proposeCall.error : null),
  };
  const executeProposal = {
    ...simulation,
    data:
      executeCall?.status === "success" && executeRequest
        ? { request: executeRequest, result: executeCall.result }
        : undefined,
    error:
      simulation.error ??
      (proposeCall?.status === "failure"
        ? proposeCall.error
        : executeCall?.status === "failure"
          ? executeCall.error
          : null),
  };
  return { propose, executeProposal, proposalData };
}

const proposeAbi = [...upgradeableModularAccountAbi, ...exaPluginAbi, ...proposalManagerAbi];
const executeProposalAbi = [
  ...upgradeableModularAccountAbi,
  ...exaPluginAbi,
  ...proposalManagerAbi,
  ...auditorAbi,
  ...marketAbi,
];

type CallResult = { error: Error; status: "failure" } | { result: unknown; status: "success" };
