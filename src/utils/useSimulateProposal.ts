import { useMemo } from "react";

import {
  bytesToHex,
  encodeAbiParameters,
  hexToBigInt,
  hexToBytes,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
  type BlockOverrides,
  type Hex,
  type StateOverride,
} from "viem";
import { useBytecode, useChainId, useSimulateContract } from "wagmi";

import {
  auditorAbi,
  exaPluginAbi,
  exaPluginAddress,
  marketAbi,
  proposalManagerAbi,
  proposalManagerAddress,
  swapperAddress,
  upgradeableModularAccountAbi,
  useReadExaPreviewerAssets,
  useReadProposalManagerDelay,
  useReadProposalManagerQueueNonces,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";

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
  const chainId = useChainId();
  const plugin = exaPluginAddress[chainId as keyof typeof exaPluginAddress];
  const manager = proposalManagerAddress[chainId as keyof typeof proposalManagerAddress];
  const swapper = swapperAddress[chainId as keyof typeof swapperAddress];
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
  const propose = useSimulateContract({
    account,
    address: account,
    functionName: "propose",
    abi: [...upgradeableModularAccountAbi, ...exaPluginAbi, ...proposalManagerAbi],
    args: [market ?? zeroAddress, amount ?? 0n, proposal.proposalType, proposalData ?? "0x"],
    query: { enabled: enabled && !!deployed && !!account && !!amount },
  });

  const { data: proposalDelay } = useReadProposalManagerDelay({ query: { enabled } });
  const { data: assets } = useReadExaPreviewerAssets({ query: { enabled } });
  const { data: nonce } = useReadProposalManagerQueueNonces({
    args: [account ?? zeroAddress],
    query: { enabled: enabled && !!account },
  });

  const stateOverride = useMemo(() => {
    if (
      account === undefined ||
      amount === undefined ||
      market === undefined ||
      assets === undefined ||
      nonce === undefined ||
      proposalData === undefined
    ) {
      return;
    }
    const proposalsSlot = hexToBigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "bytes32" }],
          [nonce, keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account, 5n]))],
        ),
      ),
    );
    const proposalDataSlot = hexToBigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [proposalsSlot + 4n])));
    const proposalDataBytes = hexToBytes(proposalData);
    return [
      {
        address: manager,
        state: [
          {
            // nonces[account]
            slot: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account, 3n])),
            value: encodeAbiParameters([{ type: "uint256" }], [nonce]),
          },
          {
            // queueNonces[account]
            slot: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account, 4n])),
            value: encodeAbiParameters([{ type: "uint256" }], [nonce + 1n]),
          },
          {
            // proposals[account][nonce][0] (amount)
            slot: encodeAbiParameters([{ type: "uint256" }], [proposalsSlot]),
            value: encodeAbiParameters([{ type: "uint256" }], [amount]),
          },
          {
            // proposals[account][nonce][1] (market)
            slot: encodeAbiParameters([{ type: "uint256" }], [proposalsSlot + 1n]),
            value: encodeAbiParameters([{ type: "address" }], [market]),
          },
          {
            // proposals[account][nonce][3] (proposalType)
            slot: encodeAbiParameters([{ type: "uint256" }], [proposalsSlot + 3n]),
            value: encodeAbiParameters([{ type: "uint8" }], [proposal.proposalType]),
          },
          {
            // proposals[account][nonce][4] (2 * proposalData.length + 1)
            slot: encodeAbiParameters([{ type: "uint256" }], [proposalsSlot + 4n]),
            value: encodeAbiParameters([{ type: "uint256" }], [BigInt(2 * proposalDataBytes.length + 1)]),
          },
          ...Array.from({ length: Math.ceil(proposalDataBytes.length / 32) }, (_, index) => ({
            // keccak256(proposalData.slot) (proposalData)
            slot: encodeAbiParameters([{ type: "uint256" }], [proposalDataSlot + BigInt(index)]),
            value: encodeAbiParameters(
              [{ type: "bytes32" }],
              [bytesToHex(proposalDataBytes.slice(index * 32, (index + 1) * 32))],
            ),
          })),
          {
            // hasRole(PROPOSER_ROLE, exaPlugin)
            slot: keccak256(
              encodeAbiParameters(
                [{ type: "address" }, { type: "bytes32" }],
                [
                  plugin,
                  keccak256(
                    encodeAbiParameters(
                      [{ type: "bytes32" }, { type: "uint256" }],
                      [keccak256(toBytes("PROPOSER_ROLE")), 0n],
                    ),
                  ),
                ],
              ),
            ),
            value: encodeAbiParameters([{ type: "bool" }], [true]),
          },
          ...[swapper, ...assets.map(({ asset }) => asset)].map((target) => ({
            // allowlist[target]
            slot: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [target, 2n])),
            value: encodeAbiParameters([{ type: "bool" }], [true]),
          })),
        ],
      },
    ] satisfies StateOverride;
  }, [account, amount, assets, manager, market, nonce, plugin, proposal.proposalType, proposalData, swapper]);
  const blockOverrides =
    proposalDelay === undefined
      ? undefined
      : ({ time: BigInt(Math.floor(Date.now() / 1000)) + proposalDelay } satisfies BlockOverrides);
  const executeProposal = useSimulateContract({
    account,
    address: account,
    functionName: "executeProposal",
    args: [nonce ?? 0n],
    abi: [...upgradeableModularAccountAbi, ...exaPluginAbi, ...proposalManagerAbi, ...auditorAbi, ...marketAbi],
    stateOverride,
    blockOverrides,
    query: {
      enabled: enabled && !!deployed && nonce !== undefined && !!account && !!stateOverride && !!blockOverrides,
    },
  });

  return { propose, executeProposal, proposalData };
}
