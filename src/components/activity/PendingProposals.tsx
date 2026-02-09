import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl, ScrollView } from "react-native";

import { useRouter } from "expo-router";

import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CircleHelp,
  Coins,
  RefreshCw,
  SearchSlash,
  Shuffle,
} from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { extractChain, type Chain } from "viem";
import * as chains from "viem/chains";

import chain from "@exactly/common/generated/chain";
import ProposalType, {
  decodeBorrowAtMaturity,
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
  decodeWithdraw,
} from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import usePendingOperations from "../../utils/usePendingOperations";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

import type { RouteFrom } from "../../utils/lifi";
import type { MutationState } from "@tanstack/react-query";
import type { TFunction } from "i18next";

type Proposal = {
  amount: bigint;
  data: `0x${string}`;
  market: `0x${string}`;
  proposalType: ProposalType;
  timestamp: bigint;
};

type ProposalWithMetadata = Proposal & {
  decoded?:
    | ReturnType<typeof decodeBorrowAtMaturity>
    | ReturnType<typeof decodeCrossRepayAtMaturity>
    | ReturnType<typeof decodeRepayAtMaturity>
    | ReturnType<typeof decodeRollDebt>
    | { receiver: ReturnType<typeof decodeWithdraw> };
  icon: React.ReactNode;
  label: string;
};

function getProposalLabel(proposalType: ProposalType, t: TFunction): string {
  switch (proposalType) {
    case ProposalType.BorrowAtMaturity:
      return t("Protocol borrow");
    case ProposalType.RepayAtMaturity:
    case ProposalType.CrossRepayAtMaturity:
      return t("Debt payment");
    case ProposalType.RollDebt:
      return t("Debt rollover");
    case ProposalType.Swap:
      return t("Swapping");
    case ProposalType.Redeem:
    case ProposalType.Withdraw:
      return t("Sending to");
    default:
      return t("Unknown");
  }
}

function getProposal(proposal: Proposal, t: TFunction): ProposalWithMetadata {
  const { data, proposalType } = proposal;
  switch (proposalType) {
    case ProposalType.BorrowAtMaturity:
      return {
        ...proposal,
        label: getProposalLabel(proposalType, t),
        icon: <Coins color="$interactiveOnBaseInformationSoft" />,
        decoded: decodeBorrowAtMaturity(data),
      };
    case ProposalType.RepayAtMaturity:
      return {
        ...proposal,
        label: getProposalLabel(proposalType, t),
        icon: <Coins color="$interactiveOnBaseInformationSoft" />,
        decoded: decodeRepayAtMaturity(data),
      };
    case ProposalType.CrossRepayAtMaturity:
      return {
        ...proposal,
        label: getProposalLabel(proposalType, t),
        icon: <Coins color="$interactiveOnBaseInformationSoft" />,
        decoded: decodeCrossRepayAtMaturity(data),
      };
    case ProposalType.RollDebt:
      return {
        ...proposal,
        label: getProposalLabel(proposalType, t),
        icon: <RefreshCw color="$interactiveOnBaseInformationSoft" />,
        decoded: decodeRollDebt(data),
      };
    case ProposalType.Swap:
      return {
        ...proposal,
        label: getProposalLabel(proposalType, t),
        icon: <ArrowLeftRight color="$interactiveOnBaseInformationSoft" />,
        decoded: undefined,
      };
    case ProposalType.Redeem:
    case ProposalType.Withdraw:
      return {
        ...proposal,
        label: getProposalLabel(proposalType, t),
        icon: <ArrowUpRight color="$interactiveOnBaseInformationSoft" />,
        decoded: { receiver: decodeWithdraw(data) },
      };
    default:
      return {
        ...proposal,
        label: getProposalLabel(proposalType, t),
        icon: <SearchSlash color="$interactiveOnBaseInformationSoft" />,
        decoded: undefined,
      };
  }
}

export default function PendingProposals() {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    count,
    mutations,
    proposals: { isLoading, refetch: refetchPendingProposals, data: pendingProposals },
  } = usePendingOperations();
  return (
    <SafeView fullScreen>
      <View fullScreen padded>
        <View flexDirection="row" gap="$s3_5" paddingBottom="$s4" justifyContent="space-between" alignItems="center">
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(main)/(home)");
              }
            }}
          >
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <View flexDirection="row" alignItems="center">
            <Text color="$uiNeutralSecondary" fontSize={15} fontWeight="bold">
              {t("Pending requests")}
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
            {count === 0 && (
              <YStack alignItems="center" justifyContent="center" gap="$s4" paddingTop="$s4">
                <Text textAlign="center" color="$uiNeutralSecondary" emphasized headline>
                  🙌
                </Text>
                <Text textAlign="center" color="$uiNeutralSecondary" footnote>
                  {t("There are no pending requests!")}
                </Text>
              </YStack>
            )}
            {pendingProposals?.map(({ nonce, proposal }) => {
              return <ProposalItem key={String(nonce)} proposal={proposal} />;
            })}
            {mutations.map((mutation) => {
              return <MutationItem key={mutation.id} mutation={mutation} />;
            })}
          </View>
        </ScrollView>
        <View paddingHorizontal="$s8">
          <Text color="$uiNeutralPlaceholder" caption2 textAlign="center">
            {t("Each request takes about 1 minute to complete and is processed in order.")}
          </Text>
        </View>
      </View>
    </SafeView>
  );
}

function ProposalItem({ proposal }: { proposal: Proposal }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { label, icon, decoded, market: proposalMarket, proposalType } = getProposal(proposal, t);
  const { market } = useAsset(proposalMarket);
  const symbol = market ? (market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3)) : null;
  const usdValue = market ? (proposal.amount * market.usdPrice) / BigInt(10 ** market.decimals) : 0n;

  const renderMaturity = () => {
    if (!decoded) return null;
    if ("maturity" in decoded) {
      return new Date(Number(decoded.maturity) * 1000).toLocaleDateString(language, {
        month: "short",
        day: "numeric",
      });
    }
    if ("repayMaturity" in decoded && "borrowMaturity" in decoded) {
      return `${new Date(Number(decoded.repayMaturity) * 1000).toLocaleDateString(language, {
        month: "short",
        day: "numeric",
      })} → ${new Date(Number(decoded.borrowMaturity) * 1000).toLocaleDateString(language, {
        month: "short",
        day: "numeric",
      })}`;
    }
    if ("receiver" in decoded) return shortenHex(decoded.receiver, 5, 5);
    return null;
  };

  const rendersAmount =
    proposalType === ProposalType.RepayAtMaturity ||
    proposalType === ProposalType.CrossRepayAtMaturity ||
    proposalType === ProposalType.BorrowAtMaturity ||
    proposalType === ProposalType.Redeem ||
    proposalType === ProposalType.Withdraw;

  const maturityDisplay = renderMaturity();

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
          {maturityDisplay && (
            <Text footnote maxFontSizeMultiplier={1} color="$uiNeutralSecondary" numberOfLines={1}>
              {maturityDisplay}
            </Text>
          )}
        </YStack>
        <YStack alignItems="flex-end">
          <Text primary emphasized subHeadline numberOfLines={1}>
            {`$${(Number(usdValue) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </Text>
          {rendersAmount ? (
            <Text secondary footnote maxFontSizeMultiplier={1} numberOfLines={1}>
              {`${(Number(proposal.amount) / 10 ** (market?.decimals ?? 18)).toLocaleString(language, {
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

function MutationItem({ mutation }: { mutation: MutationState<unknown, Error, RouteFrom> & { id: number } }) {
  const { t } = useTranslation();
  const { name: sourceChainName } = extractChain({
    chains: Object.values(chains) as unknown as readonly [Chain, ...Chain[]],
    id: mutation.variables?.chainId ?? 0,
  });
  // TODO map values to other supported mutations
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
        <Shuffle color="$interactiveOnBaseInformationSoft" />
      </View>
      <XStack justifyContent="space-between" flex={1}>
        <YStack flex={1}>
          <Text subHeadline maxFontSizeMultiplier={1} color="$uiPrimary" numberOfLines={1}>
            {t("Bridge")}
          </Text>
          <Text footnote maxFontSizeMultiplier={1} color="$uiNeutralSecondary" numberOfLines={1}>
            {sourceChainName} → {chain.name}
          </Text>
        </YStack>
      </XStack>
    </XStack>
  );
}
