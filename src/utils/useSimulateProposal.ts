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

export default function useSimulateProposal(parameters: UseSimulateProposalParameters) {
  const { account, enabled = true } = parameters;
  const proposals = useMemo(() => ("proposals" in parameters ? parameters.proposals : [parameters]), [parameters]);
  const { data: deployed } = useBytecode({ address: account ?? zeroAddress, query: { enabled: enabled && !!account } });
  const proposalEntries = useMemo(
    () =>
      proposals.map((proposal) => {
        const proposalData = encodeProposalData(proposal);
        const legacyWithdraw = isLegacyWithdrawProposal(proposal);
        const argumentsAndAbi = legacyWithdraw
          ? {
              abi: legacyProposeAbi,
              args: [proposal.market ?? zeroAddress, proposal.amount ?? 0n, proposal.receiver ?? zeroAddress] as const,
            }
          : {
              abi: proposeAbi,
              args: [
                proposal.market ?? zeroAddress,
                proposal.amount ?? 0n,
                proposal.proposalType,
                proposalData ?? "0x",
              ] as const,
            };
        const calldata = encodeFunctionData({
          abi: argumentsAndAbi.abi,
          functionName: "propose",
          args: argumentsAndAbi.args,
        });
        const call: ProposalCall | undefined = account === undefined ? undefined : { data: calldata, to: account };
        return {
          args: argumentsAndAbi.args,
          call,
          proposal,
          proposalData,
          request:
            account === undefined
              ? undefined
              : ({
                  account,
                  address: account,
                  abi: argumentsAndAbi.abi,
                  functionName: "propose",
                  args: argumentsAndAbi.args,
                } satisfies ProposeRequest),
          valid:
            account !== undefined &&
            proposal.amount !== undefined &&
            proposal.market !== undefined &&
            (legacyWithdraw ? proposal.receiver !== undefined : proposalData !== undefined),
        };
      }),
    [account, proposals],
  );
  const { data: proposalDelay } = useReadProposalManagerDelay({ address: proposalManagerAddress, query: { enabled } });
  const { data: nonce } = useReadProposalManagerQueueNonces({
    address: proposalManagerAddress,
    args: account ? [account] : undefined,
    query: { enabled: enabled && !!account },
  });
  const executeEntries = useMemo(
    () =>
      proposals.map((_, index) => {
        const args = [(nonce ?? 0n) + BigInt(index)] as const;
        const calldata = encodeFunctionData({ abi: executeProposalAbi, functionName: "executeProposal", args });
        const call = account === undefined ? undefined : { data: calldata, to: account };
        return {
          args,
          call,
          request:
            account === undefined
              ? undefined
              : ({
                  account,
                  address: account,
                  abi: executeProposalAbi,
                  functionName: "executeProposal",
                  args,
                } as const),
        };
      }),
    [account, nonce, proposals],
  );
  const simulationTime = useMemo(
    () => (proposalDelay === undefined ? undefined : BigInt(Math.floor(Date.now() / 1000)) + proposalDelay),
    [proposalDelay],
  );
  const simulation = useSimulateBlocks({
    blocks: [
      {
        calls: proposalEntries.map((entry) => ({
          account,
          to: account ?? zeroAddress,
          data: entry.call?.data ?? "0x",
        })),
      },
      {
        blockOverrides: simulationTime === undefined ? undefined : { time: simulationTime },
        calls: executeEntries.map((entry) => ({
          account,
          to: account ?? zeroAddress,
          data: entry.call?.data ?? "0x",
        })),
      },
    ],
    query: {
      enabled:
        enabled &&
        !!deployed &&
        !!account &&
        proposals.length > 0 &&
        proposalEntries.every(({ valid }) => valid) &&
        nonce !== undefined &&
        simulationTime !== undefined,
    },
  });
  const proposePayloads = proposalEntries.map((entry) => entry.call).filter((value) => isDefined(value));
  const proposeRequests = proposalEntries.map((entry) => entry.request).filter((value) => isDefined(value));
  const executePayloads = executeEntries.map((entry) => entry.call).filter((value) => isDefined(value));
  const executeRequests = executeEntries.map((entry) => entry.request).filter((value) => isDefined(value));
  const proposeCalls = simulation.data?.[0]?.calls as CallResult[] | undefined;
  const executeCalls = simulation.data?.[1]?.calls as CallResult[] | undefined;
  const successfulProposeCalls = proposeCalls?.every((call) => isSuccessCall(call)) ? proposeCalls : undefined;
  const successfulExecuteCalls = executeCalls?.every((call) => isSuccessCall(call)) ? executeCalls : undefined;
  const failedProposeCall = proposeCalls?.find((call) => isFailureCall(call));
  const failedExecuteCall = executeCalls?.find((call) => isFailureCall(call));
  const firstProposeRequest = proposeRequests[0];
  const firstProposeResult = successfulProposeCalls?.[0];
  const firstExecuteRequest = executeRequests[0];
  const firstExecuteResult = successfulExecuteCalls?.[0];
  const propose = {
    ...simulation,
    data:
      successfulProposeCalls &&
      firstProposeRequest &&
      firstProposeResult &&
      proposePayloads.length === proposals.length &&
      proposeRequests.length === proposals.length &&
      successfulProposeCalls.length === proposals.length &&
      proposals.length > 0
        ? {
            calls: proposePayloads,
            request: firstProposeRequest,
            requests: proposeRequests,
            result: firstProposeResult.result,
            results: successfulProposeCalls.map((call) => call.result),
          }
        : undefined,
    error: simulation.error ?? failedProposeCall?.error ?? null,
  };
  const executeProposal = {
    ...simulation,
    data:
      successfulExecuteCalls &&
      firstExecuteRequest &&
      firstExecuteResult &&
      executePayloads.length === proposals.length &&
      executeRequests.length === proposals.length &&
      successfulExecuteCalls.length === proposals.length &&
      proposals.length > 0
        ? {
            calls: executePayloads,
            request: firstExecuteRequest,
            requests: executeRequests,
            result: firstExecuteResult.result,
            results: successfulExecuteCalls.map((call) => call.result),
          }
        : undefined,
    error: simulation.error ?? failedProposeCall?.error ?? failedExecuteCall?.error ?? null,
  };
  return {
    propose,
    executeProposal,
    proposalData: proposals.length === 1 ? proposalEntries[0]?.proposalData : undefined,
  };
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

type CallResult = { error: Error; status: "failure" } | { result: unknown; status: "success" };
type ProposalCall = { data: Hex; to: Address };
type ProposeRequest = {
  abi: readonly unknown[];
  account: Address;
  address: Address;
  args: readonly unknown[];
  functionName: "propose";
};

type Proposal =
  | {
      amount: bigint | undefined;
      assetOut: Address | undefined;
      market: Address | undefined;
      minAmountOut: bigint | undefined;
      proposalType: typeof ProposalType.Swap;
      route: Hex | undefined;
    }
  | {
      amount: bigint | undefined;
      borrowMaturity: bigint | undefined;
      market: Address | undefined;
      maxRepayAssets: bigint | undefined;
      percentage: bigint | undefined;
      proposalType: typeof ProposalType.RollDebt;
      repayMaturity: bigint | undefined;
    }
  | {
      amount: bigint | undefined;
      legacy?: boolean;
      market: Address | undefined;
      proposalType: typeof ProposalType.Withdraw;
      receiver: Address | undefined;
    }
  | {
      amount: bigint | undefined;
      market: Address | undefined;
      maturity: bigint | undefined;
      maxAssets: bigint | undefined;
      proposalType: typeof ProposalType.BorrowAtMaturity;
      receiver: Address | undefined;
    }
  | {
      amount: bigint | undefined;
      market: Address | undefined;
      maturity: bigint | undefined;
      maxRepay: bigint | undefined;
      positionAssets: bigint | undefined;
      proposalType: typeof ProposalType.CrossRepayAtMaturity;
      route: Hex | undefined;
    }
  | {
      amount: bigint | undefined;
      market: Address | undefined;
      maturity: bigint | undefined;
      positionAssets: bigint | undefined;
      proposalType: typeof ProposalType.RepayAtMaturity;
    }
  | {
      amount: bigint | undefined;
      market: Address | undefined;
      proposalType: typeof ProposalType.Redeem;
      receiver: Address | undefined;
    };

type UseSimulateProposalParameters =
  | (Proposal & { account: Address | undefined; enabled?: boolean })
  | { account: Address | undefined; enabled?: boolean; proposals: readonly Proposal[] };

function isFailureCall(call: CallResult): call is { error: Error; status: "failure" } {
  return call.status === "failure";
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isLegacyWithdrawProposal(
  proposal: Proposal,
): proposal is Extract<Proposal, { proposalType: typeof ProposalType.Withdraw }> & { legacy: true } {
  return proposal.proposalType === ProposalType.Withdraw && proposal.legacy === true;
}

function isSuccessCall(call: CallResult): call is { result: unknown; status: "success" } {
  return call.status === "success";
}

function encodeProposalData(proposal: Proposal) {
  if (proposal.proposalType === ProposalType.BorrowAtMaturity) {
    return proposal.maturity === undefined || proposal.maxAssets === undefined || proposal.receiver === undefined
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
        );
  }
  if (proposal.proposalType === ProposalType.CrossRepayAtMaturity) {
    return proposal.maturity === undefined ||
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
        );
  }
  if (proposal.proposalType === ProposalType.RepayAtMaturity) {
    return proposal.maturity === undefined || proposal.positionAssets === undefined
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
        );
  }
  if (proposal.proposalType === ProposalType.RollDebt) {
    return proposal.repayMaturity === undefined ||
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
        );
  }
  if (proposal.proposalType === ProposalType.Swap) {
    return proposal.assetOut === undefined || proposal.minAmountOut === undefined || proposal.route === undefined
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
        );
  }
  return proposal.receiver && encodeAbiParameters([{ type: "address" }], [proposal.receiver]);
}
