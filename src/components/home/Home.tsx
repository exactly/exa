import { exaPluginAddress, exaPreviewerAddress, previewerAddress } from "@exactly/common/generated/chain";
import { healthFactor, WAD } from "@exactly/lib";
import { TimeToFullDisplay } from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl } from "react-native";
import { AnimatePresence, ScrollView, useTheme, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import CardStatus from "./CardStatus";
import GettingStarted from "./GettingStarted";
import HomeActions from "./HomeActions";
import HomeDisclaimer from "./HomeDisclaimer";
import HomePortfolioSkeleton from "./HomePortfolioSkeleton";
import HomeSkeleton from "./HomeSkeleton";
import PortfolioSummary from "./PortfolioSummary";
import SpendingLimitsSheet from "./SpendingLimitsSheet";
import CardUpgradeSheet from "./card-upgrade/CardUpgradeSheet";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import {
  useReadExaPreviewerPendingProposals,
  useReadPreviewerExactly,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import { KYC_TEMPLATE_ID, LEGACY_KYC_TEMPLATE_ID } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, getActivity, getCard, getKYCStatus } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import usePortfolio from "../../utils/usePortfolio";
import OverduePayments from "../pay-mode/OverduePayments";
import PaymentSheet from "../pay-mode/PaymentSheet";
import UpcomingPayments from "../pay-mode/UpcomingPayments";
import InfoAlert from "../shared/InfoAlert";
import LatestActivity from "../shared/LatestActivity";
import LiquidationAlert from "../shared/LiquidationAlert";
import ProfileHeader from "../shared/ProfileHeader";
import SafeView from "../shared/SafeView";
import View from "../shared/View";

const HEALTH_FACTOR_THRESHOLD = (WAD * 11n) / 10n;

export default function Home() {
  const theme = useTheme();
  const parameters = useLocalSearchParams();
  const navigation = useNavigation<AppNavigationProperties>();

  const { t } = useTranslation();

  const [paySheetOpen, setPaySheetOpen] = useState(false);
  const [spendingLimitsInfoSheetOpen, setSpendingLimitsInfoSheetOpen] = useState(false);

  const { address: account } = useAccount();

  const {
    status: bytecodeStatus,
    data: bytecode,
    refetch: refetchBytecode,
    isFetching: isFetchingBytecode,
    error: bytecodeError,
  } = useBytecode({
    address: account ?? zeroAddress,
    query: { enabled: !!account },
  });
  const {
    data: installedPlugins,
    refetch: refetchInstalledPlugins,
    isFetching: isFetchingInstalledPlugins,
  } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account ?? zeroAddress,
    query: { enabled: !!account && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  const {
    portfolio: { usdBalance },
  } = usePortfolio(account);

  const { data: cardUpgradeOpen } = useQuery<boolean>({
    initialData: false,
    queryKey: ["card-upgrade-open"],
    queryFn: () => {
      return false;
    },
  });

  const {
    status: cardStatus,
    data: card,
    refetch: refetchCard,
    isFetching: isFetchingCard,
    error: cardError,
  } = useQuery({ queryKey: ["card", "details"], queryFn: getCard, enabled: !!bytecode });
  const pendingProposalsEnabled = !!account && !!bytecode;
  const {
    status: pendingProposalsStatus,
    refetch: refetchPendingProposals,
    isFetching: isFetchingPendingProposals,
    error: pendingProposalsError,
  } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [account ?? zeroAddress],
    query: { enabled: pendingProposalsEnabled, gcTime: 0, refetchInterval: 30_000 },
  });
  const {
    data: activity,
    status: activityStatus,
    refetch: refetchActivity,
    isFetching: isFetchingActivity,
    error: activityError,
  } = useQuery({ queryKey: ["activity"], queryFn: () => getActivity() });
  const {
    data: markets,
    status: marketsStatus,
    refetch: refetchMarkets,
    isFetching: isFetchingMarkets,
    error: marketsError,
  } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  const {
    data: KYCStatus,
    status: KYCStatusStatus,
    isFetched: isKYCStatusFetched,
    refetch: refetchKYCStatus,
    error: KYCStatusError,
  } = useQuery({
    queryKey: ["kyc", "status"],
    queryFn: async () => getKYCStatus(KYC_TEMPLATE_ID),
    enabled: !!bytecode,
    meta: {
      suppressError: (error) =>
        error instanceof APIError &&
        (error.text === "kyc not found" || error.text === "kyc not started" || error.text === "kyc not approved"),
    },
  });

  const legacyKYCEnabled = isKYCStatusFetched && KYCStatus !== "ok" && !!bytecode;
  const {
    data: legacyKYCStatus,
    status: legacyKYCStatusStatus,
    refetch: refetchLegacyKYCStatus,
    error: legacyKYCStatusError,
  } = useQuery({
    queryKey: ["legacy", "kyc", "status"],
    queryFn: async () => getKYCStatus(LEGACY_KYC_TEMPLATE_ID),
    enabled: legacyKYCEnabled,
    meta: {
      suppressError: (error) =>
        error instanceof APIError &&
        (error.text === "kyc not found" || error.text === "kyc not started" || error.text === "kyc not approved"),
    },
  });

  const hasAccount = !!account;
  const hasBytecode = !!bytecode;

  const isBytecodeInitialLoading = hasAccount && bytecodeStatus === "pending" && !bytecodeError;
  const isPendingProposalsInitialLoading =
    pendingProposalsEnabled && pendingProposalsStatus === "pending" && !pendingProposalsError;
  const isCardInitialLoading = hasBytecode && cardStatus === "pending" && !cardError;
  const isActivityInitialLoading = activityStatus === "pending" && !activityError;
  const isMarketsInitialLoading = marketsStatus === "pending" && !marketsError;
  const isKYCInitialLoading = !!bytecode && KYCStatusStatus === "pending" && !KYCStatusError;
  const isLegacyKYCInitialLoading = legacyKYCEnabled && legacyKYCStatusStatus === "pending" && !legacyKYCStatusError;

  const isPortfolioSkeletonVisible = isMarketsInitialLoading;
  const isContentSkeletonVisible =
    (hasBytecode ? isCardInitialLoading : isBytecodeInitialLoading) ||
    isActivityInitialLoading ||
    isMarketsInitialLoading ||
    isPendingProposalsInitialLoading ||
    isKYCInitialLoading ||
    isLegacyKYCInitialLoading;

  const isRefreshing =
    isFetchingBytecode ||
    isFetchingInstalledPlugins ||
    isFetchingPendingProposals ||
    isFetchingMarkets ||
    isFetchingActivity ||
    isFetchingCard;

  const handleRefresh = useCallback(() => {
    refetchActivity().catch(reportError);
    refetchBytecode().catch(reportError);
    refetchCard().catch(reportError);
    refetchInstalledPlugins().catch(reportError);
    refetchMarkets().catch(reportError);
    refetchPendingProposals().catch(reportError);
    refetchKYCStatus().catch(reportError);
    refetchLegacyKYCStatus().catch(reportError);
  }, [
    refetchActivity,
    refetchBytecode,
    refetchCard,
    refetchInstalledPlugins,
    refetchMarkets,
    refetchPendingProposals,
    refetchKYCStatus,
    refetchLegacyKYCStatus,
  ]);

  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <ScrollView
          ref={homeScrollReference}
          backgroundColor="$backgroundMild"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              ref={homeRefreshControlReference}
              style={{ backgroundColor: theme.backgroundSoft.val, margin: -5 }} // eslint-disable-line react-native/no-inline-styles
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          <ProfileHeader />
          <View flex={1}>
            <YStack backgroundColor="$backgroundSoft" padding="$s4">
              <AnimatePresence exitBeforeEnter>
                {isPortfolioSkeletonVisible ? (
                  <YStack key="home-portfolio-skeleton" gap="$s4" width="100%" {...fadeAnimation}>
                    <HomePortfolioSkeleton />
                  </YStack>
                ) : (
                  <YStack key="home-portfolio" gap="$s4" width="100%" {...fadeAnimation}>
                    {markets && healthFactor(markets) < HEALTH_FACTOR_THRESHOLD && <LiquidationAlert />}
                    {(legacyKYCStatus === "ok" && KYCStatus !== "ok") ||
                      (bytecode && !isLatestPlugin && (
                        <InfoAlert
                          title={t(
                            "We’re upgrading all Exa Cards by migrating them to a new and improved card issuer. Existing cards will work until May 18th, 2025, and upgrading will be required after this date.",
                          )}
                          actionText={t("Start Exa Card upgrade")}
                          onPress={() => {
                            queryClient.setQueryData(["card-upgrade-open"], true);
                          }}
                        />
                      ))}
                    <YStack gap="$s8">
                      <PortfolioSummary />
                      <HomeActions disableSend={!bytecode} />
                    </YStack>
                  </YStack>
                )}
              </AnimatePresence>
            </YStack>
            <View padded gap="$s5">
              <AnimatePresence exitBeforeEnter>
                {isContentSkeletonVisible ? (
                  <YStack key="home-content-skeleton" gap="$s5" width="100%" {...fadeAnimation}>
                    <HomeSkeleton />
                  </YStack>
                ) : (
                  <YStack key="home-content" gap="$s5" width="100%" {...fadeAnimation}>
                    {card && (
                      <CardStatus
                        onInfoPress={() => {
                          setSpendingLimitsInfoSheetOpen(true);
                        }}
                      />
                    )}
                    <GettingStarted hasFunds={usdBalance > 0n} hasKYC={KYCStatus === "ok"} />
                    <OverduePayments
                      onSelect={(maturity) => {
                        navigation.setParams({ ...parameters, maturity: maturity.toString() });
                        setPaySheetOpen(true);
                      }}
                    />
                    <UpcomingPayments
                      onSelect={(maturity) => {
                        navigation.setParams({ ...parameters, maturity: maturity.toString() });
                        setPaySheetOpen(true);
                      }}
                    />
                    <LatestActivity activity={activity} />
                  </YStack>
                )}
              </AnimatePresence>
              <HomeDisclaimer />
            </View>
          </View>
        </ScrollView>
        <PaymentSheet
          open={paySheetOpen}
          onClose={() => {
            setPaySheetOpen(false);
            navigation.setParams({ ...parameters, maturity: undefined });
          }}
        />
        <CardUpgradeSheet
          open={cardUpgradeOpen}
          onClose={() => {
            queryClient.setQueryData(["card-upgrade-open"], false);
            queryClient.resetQueries({ queryKey: ["card-upgrade"] }).catch(reportError);
          }}
        />
        <SpendingLimitsSheet
          open={spendingLimitsInfoSheetOpen}
          onClose={() => {
            setSpendingLimitsInfoSheetOpen(false);
          }}
        />
        <TimeToFullDisplay record={!!markets && !!activity} />
      </View>
    </SafeView>
  );
}

const fadeAnimation = { animation: "medium" as const, enterStyle: { opacity: 0 }, exitStyle: { opacity: 0 } };

export const homeScrollReference = React.createRef<ScrollView>();
export const homeRefreshControlReference = React.createRef<RefreshControl>();
