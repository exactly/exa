import ProposalType from "@exactly/common/ProposalType";
import chain, {
  exaPluginAddress,
  exaPreviewerAddress,
  proposalManagerAddress,
  swapperAddress,
} from "@exactly/common/generated/chain";
import { useEffect, useMemo } from "react";
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
import { optimism, optimismSepolia } from "viem/chains";
import { useBlockNumber, useBytecode, useSimulateContract } from "wagmi";

import {
  auditorAbi,
  exaPluginAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  useReadExaPreviewerAssets,
  useReadProposalManagerDelay,
  useReadProposalManagerQueueNonces,
} from "../generated/contracts";

export default function useSimulateProposal({
  account,
  amount,
  market,
  enabled = true,
  ...proposal
}: {
  account: Address | undefined;
  amount: bigint | undefined;
  market: Address | undefined;
  enabled?: boolean;
} & (
  | {
      proposalType: typeof ProposalType.BorrowAtMaturity;
      maturity: bigint | undefined;
      maxAssets: bigint | undefined;
      receiver: Address | undefined;
    }
  | {
      proposalType: typeof ProposalType.CrossRepayAtMaturity;
      maturity: bigint | undefined;
      positionAssets: bigint | undefined;
      maxRepay: bigint | undefined;
      route: Hex | undefined;
    }
  | {
      proposalType: typeof ProposalType.Redeem;
      receiver: Address | undefined;
    }
  | {
      proposalType: typeof ProposalType.RepayAtMaturity;
      maturity: bigint | undefined;
      positionAssets: bigint | undefined;
    }
  | {
      proposalType: typeof ProposalType.RollDebt;
      repayMaturity: bigint | undefined;
      borrowMaturity: bigint | undefined;
      maxRepayAssets: bigint | undefined;
      percentage: bigint | undefined;
    }
  | {
      proposalType: typeof ProposalType.Swap;
      assetOut: Address | undefined;
      minAmountOut: bigint | undefined;
      route: Hex | undefined;
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
  const propose = useSimulateContract({
    account,
    address: account,
    functionName: "propose",
    abi: [...upgradeableModularAccountAbi, ...exaPluginAbi, ...proposalManagerAbi],
    args: [market ?? zeroAddress, amount ?? 0n, proposal.proposalType, proposalData ?? "0x"],
    query: { retry: false, enabled: enabled && !!deployed && !!account && !!amount },
  });

  const { data: proposalDelay } = useReadProposalManagerDelay({ address: proposalManagerAddress, query: { enabled } });
  const { data: assets } = useReadExaPreviewerAssets({ address: exaPreviewerAddress, query: { enabled } });
  const { data: nonce } = useReadProposalManagerQueueNonces({
    address: proposalManagerAddress,
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
        address: proposalManagerAddress,
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
                  exaPluginAddress,
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
          ...[swapperAddress, ...assets.map(({ asset }) => asset)].map((target) => ({
            // allowlist[target]
            slot: keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [target, 2n])),
            value: encodeAbiParameters([{ type: "bool" }], [true]),
          })),
        ],
      },
    ] satisfies StateOverride;
  }, [account, amount, assets, market, nonce, proposal.proposalType, proposalData]);
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
      retry: false,
      enabled: enabled && !!deployed && nonce !== undefined && !!account && !!stateOverride && !!blockOverrides,
    },
  });

  const { data: block } = useBlockNumber({ query: { enabled: enabled && !!executeProposal.error } });
  useEffect(() => {
    if (!executeProposal.error || proposal.proposalType !== ProposalType.CrossRepayAtMaturity) return;
    return;
    // eslint-disable-next-line no-console
    console.log(`
vm.createSelectFork("${{ [optimism.id]: "optimism", [optimismSepolia.id]: "optimism_sepolia" }[chain.id]}", ${block});
IExaAccount account = IExaAccount(${account});
ExaPlugin exaPlugin = ExaPlugin(payable(broadcast("ExaPlugin")));
address ogProposalManager = broadcast("ProposalManager");
IMarket market = IMarket(${market});
ProposalManager proposalManager = ProposalManager(address(0x420));
vm.etch(address(proposalManager), address(ogProposalManager).code);
vm.label(address(proposalManager), "FakeProposalManager");
vm.label(address(account), "account");
vm.label(address(ENTRYPOINT), "ENTRYPOINT");
vm.label(ACCOUNT_IMPL, "ACCOUNT_IMPL");
protocol("OP");
protocol("Auditor");
protocol("MarketOP");
protocol("MarketUSDC");
protocol("MarketUSDC.e");
protocol("MarketWETH");
protocol("MarketWBTC");
protocol("RewardsController");
protocol("InterestRateModelUSDC");
protocol("InterestRateModelWBTC");

vm.startPrank(protocol("ProxyAdmin"));
ITransparentUpgradeableProxy(payable(protocol("MarketWBTC"))).upgradeTo(
  address(new Market(ERC20(protocol("WBTC")), Auditor(protocol("Auditor"))))
);

vm.startPrank(acct("admin"));
exaPlugin.setProposalManager(IProposalManager(proposalManager));

uint256 nonce = ${nonce};
uint256 amount = ${amount};
ProposalType proposalType = ProposalType.${
      {
        [ProposalType.CrossRepayAtMaturity]: "CROSS_REPAY_AT_MATURITY",
        [ProposalType.RepayAtMaturity]: "REPAY_AT_MATURITY",
      }[proposal.proposalType]
    };
bytes memory data;
{
  uint256 maturity = ${proposal.maturity};
  uint256 maxRepay = ${proposal.maxRepay};
  uint256 positionAssets = ${proposal.positionAssets};
  bytes memory route = hex"${proposal.route?.slice(2)}";

  data = abi.encode(
    CrossRepayData({ maturity: maturity, positionAssets: positionAssets, maxRepay: maxRepay, route: route })
  );
}

uint256 proposalSlot = uint256(keccak256(abi.encode(nonce, keccak256(abi.encode(account, 5)))));
vm.store(address(proposalManager), keccak256(abi.encode(account, 3)), bytes32(uint256(nonce)));
vm.store(address(proposalManager), keccak256(abi.encode(account, 4)), bytes32(uint256(nonce + 1)));
vm.store(address(proposalManager), bytes32(proposalSlot), bytes32(amount));
vm.store(address(proposalManager), bytes32(proposalSlot + 1), bytes32(abi.encode(market)));
vm.store(address(proposalManager), bytes32(proposalSlot + 3), bytes32(abi.encode(proposalType)));
vm.store(address(proposalManager), bytes32(proposalSlot + 4), bytes32(2 * data.length + 1));
for (uint256 start = 0; start < data.length; start += 32) {
  vm.store(
    address(proposalManager),
    bytes32(uint256(keccak256(abi.encode(proposalSlot + 4))) + (start / 32)),
    bytes32(data.slice(start, start + 32))
  );
}
vm.store(
  address(proposalManager),
  keccak256(abi.encode(exaPlugin, keccak256(abi.encode(keccak256("PROPOSER_ROLE"), uint256(0))))),
  bytes32(uint256(1))
);
vm.store(address(proposalManager), keccak256(abi.encode(acct("swapper"), 2)), bytes32(uint256(1)));
vm.store(address(proposalManager), keccak256(abi.encode(protocol("USDC"), 2)), bytes32(uint256(1)));
vm.store(address(proposalManager), keccak256(abi.encode(protocol("USDC.e"), 2)), bytes32(uint256(1)));
vm.store(address(proposalManager), keccak256(abi.encode(protocol("WETH"), 2)), bytes32(uint256(1)));
vm.store(address(proposalManager), keccak256(abi.encode(protocol("WBTC"), 2)), bytes32(uint256(1)));
vm.store(
  address(proposalManager),
  keccak256(abi.encode(0x94b008aA00579c1307B0EF2c499aD98a8ce58e58, 2)),
  bytes32(uint256(1))
);

vm.startPrank(address(account));
account.executeProposal(nonce);
`);
  }, [executeProposal.error, proposal.proposalType, block, proposal, account, nonce, amount, market]);
  return { propose, executeProposal, proposalData };
}
