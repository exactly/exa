import ProposalType, {
  decodeBorrowAtMaturity,
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
  decodeWithdraw,
} from "@exactly/common/ProposalType";
import { exaPreviewerAddress } from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import {
  ArrowLeft,
  CircleHelp,
  Coins,
  RefreshCw,
  ArrowLeftRight,
  ArrowUpRight,
  SearchSlash,
} from "@tamagui/lucide-icons";
import { format } from "date-fns";
import { useNavigation } from "expo-router";
import React from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import { useReadExaPreviewerPendingProposals } from "../../generated/contracts";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

interface Proposal {
  amount: bigint;
  market: `0x${string}`;
  timestamp: bigint;
  proposalType: ProposalType;
  data: `0x${string}`;
}

type ProposalWithMetadata = Proposal & {
  label: string;
  icon: React.ReactNode;
  decoded?:
    | ReturnType<typeof decodeBorrowAtMaturity>
    | ReturnType<typeof decodeRepayAtMaturity>
    | ReturnType<typeof decodeCrossRepayAtMaturity>
    | ReturnType<typeof decodeRollDebt>
    | { receiver: ReturnType<typeof decodeWithdraw> };
};

function getProposal(proposal: Proposal): ProposalWithMetadata {
  const { data, proposalType } = proposal;
  switch (proposalType) {
    case ProposalType.BorrowAtMaturity:
      return {
        ...proposal,
        label: "Protocol borrow",
        icon: <Coins color="$interactiveOnBaseInformationSoft" />,
        decoded: decodeBorrowAtMaturity(data),
      };
    case ProposalType.RepayAtMaturity:
      return {
        ...proposal,
        label: "Debt payment",
        icon: <Coins color="$interactiveOnBaseInformationSoft" />,
        decoded: decodeRepayAtMaturity(data),
      };
    case ProposalType.CrossRepayAtMaturity:
      return {
        ...proposal,
        label: "Debt payment",
        icon: <Coins color="$interactiveOnBaseInformationSoft" />,
        decoded: decodeCrossRepayAtMaturity(data),
      };
    case ProposalType.RollDebt:
      return {
        ...proposal,
        label: "Debt rollover",
        icon: <RefreshCw color="$interactiveOnBaseInformationSoft" />,
        decoded: decodeRollDebt(data),
      };
    case ProposalType.Swap:
      return {
        ...proposal,
        label: "Swapping",
        icon: <ArrowLeftRight color="$interactiveOnBaseInformationSoft" />,
        decoded: undefined,
      };
    case ProposalType.Redeem:
    case ProposalType.Withdraw:
      return {
        ...proposal,
        label: "Sending to",
        icon: <ArrowUpRight color="$interactiveOnBaseInformationSoft" />,
        decoded: { receiver: decodeWithdraw(data) },
      };
    default:
      return {
        ...proposal,
        label: "Unknown",
        icon: <SearchSlash color="$interactiveOnBaseInformationSoft" />,
        decoded: undefined,
      };
  }
}

export default function PendingProposals() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { address } = useAccount();
  const { presentArticle } = useIntercom();
  const {
    data: pendingProposals,
    refetch: refetchPendingProposals,
    isLoading,
  } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!address, gcTime: 0, refetchInterval: 30_000 },
  });
  return (
    <SafeView fullScreen>
      <View fullScreen padded>
        <View flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
          <Pressable
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.replace("(home)", { screen: "index" });
              }
            }}
          >
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <View flexDirection="row" alignItems="center">
            <Text color="$uiNeutralSecondary" fontSize={15} fontWeight="bold">
              Pending requests
            </Text>
          </View>
          <Pressable
            onPress={() => {
              presentArticle("10752721").catch(reportError);
            }}
          >
            <CircleHelp color="$uiNeutralPrimary" />
          </Pressable>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => {
                refetchPendingProposals().catch(reportError);
              }}
            />
          }
        >
          <View flex={1}>
            {(!pendingProposals || pendingProposals.length === 0) && (
              <YStack alignItems="center" justifyContent="center" gap="$s4" paddingTop="$s4">
                <Text textAlign="center" color="$uiNeutralSecondary" emphasized headline>
                  🙌
                </Text>
                <Text textAlign="center" color="$uiNeutralSecondary" footnote>
                  There are no pending requests!
                </Text>
              </YStack>
            )}
            {pendingProposals?.map(({ nonce, proposal }) => {
              return <ProposalItem key={nonce.toString()} proposal={proposal} />;
            })}
          </View>
        </ScrollView>
        <View paddingHorizontal="$s8">
          <Text color="$uiNeutralPlaceholder" caption2 textAlign="center">
            Each request takes about 1 minute to complete and is processed in order.
          </Text>
        </View>
      </View>
    </SafeView>
  );
}

function ProposalItem({ proposal }: { proposal: Proposal }) {
  const { label, icon, decoded, market: proposalMarket, proposalType } = getProposal(proposal);
  const { market } = useAsset(proposalMarket);
  const symbol = market ? (market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3)) : null;
  const usdValue = market ? (proposal.amount * market.usdPrice) / BigInt(10 ** market.decimals) : 0n;

  const renderMaturity = () => {
    if (!decoded) return null;
    if ("maturity" in decoded) {
      return format(new Date(Number(decoded.maturity) * 1000), "MMM dd");
    }
    if ("repayMaturity" in decoded && "borrowMaturity" in decoded) {
      return `${format(new Date(Number(decoded.repayMaturity) * 1000), "MMM dd")} → ${format(new Date(Number(decoded.borrowMaturity) * 1000), "MMM dd")}`;
    }
    if ("receiver" in decoded) {
      return shortenHex(decoded.receiver, 5, 5);
    }
    return null;
  };

  const rendersAmount =
    proposalType === ProposalType.RepayAtMaturity ||
    proposalType === ProposalType.CrossRepayAtMaturity ||
    proposalType === ProposalType.BorrowAtMaturity ||
    proposalType === ProposalType.Redeem ||
    proposalType === ProposalType.Withdraw;

  return (
    <XStack gap="$s4" paddingVertical="$s3">
      <View
        width={40}
        height={40}
        borderRadius="$r3"
        backgroundColor="$interactiveBaseInformationSoftDefault"
        justifyContent="center"
        alignItems="center"
      >
        {icon}
      </View>
      <XStack justifyContent="space-between" flex={1}>
        <YStack flex={1}>
          <Text subHeadline maxFontSizeMultiplier={1} color="$uiPrimary" numberOfLines={1}>
            {label}
          </Text>
          {renderMaturity() && (
            <Text footnote maxFontSizeMultiplier={1} color="$uiNeutralSecondary" numberOfLines={1}>
              {renderMaturity()}
            </Text>
          )}
        </YStack>
        <YStack alignItems="flex-end">
          <Text primary emphasized subHeadline numberOfLines={1}>
            {(Number(usdValue) / 1e18).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
          {rendersAmount ? (
            <Text secondary footnote maxFontSizeMultiplier={1} numberOfLines={1}>
              {`${(Number(proposal.amount) / 10 ** (market?.decimals ?? 18)).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: Math.min(
                  8,
                  Math.max(
                    0,
                    (market?.decimals ?? 18) - Math.ceil(Math.log10(Math.max(1, Number(proposal.amount) / 1e18))),
                  ),
                ),
              })} ${symbol}`}
            </Text>
          ) : null}
        </YStack>
      </XStack>
    </XStack>
  );
}
