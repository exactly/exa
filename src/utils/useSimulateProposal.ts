import {
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionData,
  multicall3Abi,
  parseAbi,
  slice,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { useReadContracts, type UseWriteContractReturnType } from "wagmi";

import chain, { proposalManagerAddress } from "@exactly/common/generated/chain";
import {
  auditorAbi,
  exaPluginAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
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
  poll = false,
  ...proposal
}: {
  account: Address | undefined;
  amount: bigint | undefined;
  chain?: { contracts: { multicall3: { address: Address } } };
  enabled?: boolean;
  market: Address | undefined;
  poll?: boolean;
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
  const {
    data: reads,
    error: readsError,
    isFetchedAfterMount,
    refetch: refetchReads,
  } = useReadContracts({
    contracts: [
      { address: account, abi: upgradeableModularAccountAbi, functionName: "getInstalledPlugins" },
      { address: proposalManagerAddress, abi: proposalManagerAbi, functionName: "delay" },
      {
        address: proposalManagerAddress,
        abi: proposalManagerAbi,
        functionName: "queueNonces",
        args: account ? [account] : undefined,
      },
      {
        address: proposalManagerAddress,
        abi: proposalManagerAbi,
        functionName: "nonces",
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
    ] as const,
    allowFailure: false,
    query: {
      enabled: enabled && !!account,
      refetchInterval: ({ state: { data } }) => (poll && data && data[2] > data[3] ? 5000 : false),
    },
  });
  const [plugins, delay, nonce, executed, timestamp, blockNumber] = isFetchedAfterMount ? (reads ?? []) : [];
  const proposalData =
    proposal.proposalType === ProposalType.BorrowAtMaturity
      ? encodeBorrowAtMaturity(proposal)
      : proposal.proposalType === ProposalType.CrossRepayAtMaturity
        ? encodeCrossRepayAtMaturity(proposal)
        : proposal.proposalType === ProposalType.RepayAtMaturity
          ? encodeRepayAtMaturity(proposal)
          : proposal.proposalType === ProposalType.RollDebt
            ? encodeRollDebt(proposal)
            : proposal.proposalType === ProposalType.Swap
              ? encodeSwap(proposal)
              : encodeAddress(proposal.receiver);
  const request = proposeRequest(account, market, amount, proposal.proposalType, proposalData);
  const calldata = request && encodeFunctionData(request);
  const execution =
    nonce === undefined
      ? undefined
      : encodeFunctionData({ abi: exaPluginAbi, functionName: "executeProposal", args: [nonce] });
  const simulation = useSimulateBlocks({
    blockNumber,
    blocks: blocks(account, calldata, execution, timestamp, delay),
    query: {
      enabled:
        enabled &&
        plugins !== undefined &&
        calldata !== undefined &&
        execution !== undefined &&
        blockNumber !== undefined &&
        delay !== undefined &&
        timestamp !== undefined,
    },
  });
  const [propose, execute] = simulation.data?.map(({ calls: [call] }) => call) ?? [];
  const outdated =
    proposal.proposalType === ProposalType.CrossRepayAtMaturity
      ? proposeRequest(
          account,
          market,
          amount,
          proposal.proposalType,
          encodeCrossRepayAtMaturity({ ...proposal, marketOut: undefined }),
        )
      : request;
  const legacy =
    proposal.proposalType === ProposalType.Withdraw && request !== undefined && proposal.receiver !== undefined
      ? { ...request, abi: outdatedAbi, args: [request.args[0], request.args[1], proposal.receiver] as const }
      : undefined;
  const fallback = missing(propose, calldata)
    ? legacy && {
        request: legacy,
        calls: [encodeFunctionData(legacy), encodeFunctionData({ abi: outdatedAbi, functionName: "withdraw" })],
      }
    : missing(execute, execution)
      ? outdated && {
          request: outdated,
          calls: [
            encodeFunctionData(outdated),
            encodeFunctionData({ abi: outdatedAbi, functionName: "executeProposal" }),
          ],
        }
      : proposal.proposalType === ProposalType.CrossRepayAtMaturity &&
          execute?.status === "failure" &&
          execute.data === "0x"
        ? outdated && { request: outdated, calls: [encodeFunctionData(outdated), execution] }
        : undefined;
  const retry = useSimulateBlocks({
    blockNumber,
    blocks: blocks(account, fallback?.calls[0], fallback?.calls[1], timestamp, delay),
    query: {
      enabled:
        enabled &&
        fallback !== undefined &&
        blockNumber !== undefined &&
        delay !== undefined &&
        timestamp !== undefined,
    },
  });
  const [retryPropose, retryExecute] = retry.data?.map(({ calls: [call] }) => call) ?? [];
  const settled =
    fallback === undefined || (propose?.status === "success" && retryPropose?.status === "failure")
      ? { simulation, request, propose, execute }
      : { simulation: retry, request: fallback.request, propose: retryPropose, execute: retryExecute };
  const queued = enabled && nonce !== undefined && executed !== undefined && nonce > executed;
  const error =
    readsError ??
    settled.simulation.error ??
    (settled.propose?.status === "failure" ? settled.propose.error : null) ??
    (settled.execute?.status === "failure" ? settled.execute.error : null);
  return {
    request:
      settled.propose?.status === "success" && settled.execute?.status === "success"
        ? (settled.request as Parameters<UseWriteContractReturnType["mutate"]>[0])
        : undefined,
    isPending: !error && settled.simulation.isPending,
    error,
    delay,
    queued,
    refetch: () =>
      Promise.all([refetchReads(), simulation.error && simulation.refetch(), retry.error && retry.refetch()]),
  };
}

function proposeRequest(
  account: Address | undefined,
  market: Address | undefined,
  amount: bigint | undefined,
  proposalType: ProposalType,
  data: Hex | undefined,
) {
  return account === undefined ||
    market === undefined ||
    market === zeroAddress ||
    amount === undefined ||
    data === undefined
    ? undefined
    : {
        account,
        address: account,
        abi: proposeAbi,
        functionName: "propose" as const,
        args: [market, amount, proposalType, data] as const,
      };
}

function blocks(
  account: Address | undefined,
  propose: Hex | undefined,
  execute: Hex | undefined,
  timestamp: bigint | undefined,
  delay: bigint | undefined,
) {
  return [
    {
      blockOverrides: timestamp === undefined ? undefined : { time: timestamp + 1n },
      calls: account === undefined || propose === undefined ? [] : [{ account, to: account, data: propose }],
    },
    {
      blockOverrides: timestamp === undefined || delay === undefined ? undefined : { time: timestamp + delay + 1n },
      calls: account === undefined || execute === undefined ? [] : [{ account, to: account, data: execute }],
    },
  ];
}

function missing(call: undefined | { data: Hex; status: "failure" | "success" }, calldata: Hex | undefined) {
  return (
    call?.status === "failure" &&
    calldata !== undefined &&
    call.data ===
      encodeErrorResult({
        abi: upgradeableModularAccountAbi,
        errorName: "RuntimeValidationFunctionMissing",
        args: [slice(calldata, 0, 4)],
      })
  );
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

const proposeAbi = [...upgradeableModularAccountAbi, ...exaPluginAbi, ...proposalManagerAbi, ...auditorAbi];
const outdatedAbi = [
  ...upgradeableModularAccountAbi,
  ...parseAbi([
    "function executeProposal()",
    "function propose(address market, uint256 amount, address receiver)",
    "function withdraw()",
  ]),
];
