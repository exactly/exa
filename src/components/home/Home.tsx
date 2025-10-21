import {
  exaPluginAddress,
  exaPreviewerAddress,
  previewerAddress,
  ratePreviewerAddress,
} from "@exactly/common/generated/chain";
import { floatingDepositRates, healthFactor, WAD } from "@exactly/lib";
import { TimeToFullDisplay } from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { RefreshControl } from "react-native";
import { ScrollView, useTheme, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import CardStatus from "./CardStatus";
import ExploreDeFi from "./ExploreDeFi";
import GettingStarted from "./GettingStarted";
import HomeActions from "./HomeActions";
import HomeDisclaimer from "./HomeDisclaimer";
import PortfolioSummary from "./PortfolioSummary";
import SpendingLimitsSheet from "./SpendingLimitsSheet";
import CardUpgradeSheet from "./card-upgrade/CardUpgradeSheet";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import {
  useReadExaPreviewerPendingProposals,
  useReadPreviewerExactly,
  useReadRatePreviewerSnapshot,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import { KYC_TEMPLATE_ID, LEGACY_KYC_TEMPLATE_ID } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, getActivity, getKYCStatus } from "../../utils/server";
import useAccount from "../../utils/useAccount";
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
  const [paySheetOpen, setPaySheetOpen] = useState(false);
  const [spendingLimitsInfoSheetOpen, setSpendingLimitsInfoSheetOpen] = useState(false);
  const { address: account } = useAccount();
  const { data: bytecode } = useBytecode({ address: account ?? zeroAddress, query: { enabled: !!account } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account ?? zeroAddress,
    query: { enabled: !!account && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const { data: cardUpgradeOpen } = useQuery<boolean>({
    initialData: false,
    queryKey: ["card-upgrade-open"],
    queryFn: () => {
      return false;
    },
  });
  const { data: exploreDeFiShown } = useQuery<boolean>({ queryKey: ["settings", "explore-defi-shown"] });
  const { refetch: refetchPendingProposals } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [account ?? zeroAddress],
    query: { enabled: !!account, gcTime: 0, refetchInterval: 30_000 },
  });
  const {
    data: activity,
    refetch: refetchActivity,
    isPending: isPendingActivity,
  } = useQuery({ queryKey: ["activity"], queryFn: () => getActivity() });
  const {
    data: markets,
    refetch: refetchMarkets,
    isPending: isPendingPreviewer,
  } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  const {
    data: KYCStatus,
    isFetched: isKYCFetched,
    refetch: refetchKYCStatus,
  } = useQuery({
    queryKey: ["kyc", "status"],
    queryFn: async () => getKYCStatus(KYC_TEMPLATE_ID),
    meta: {
      suppressError: (error) =>
        error instanceof APIError &&
        (error.text === "kyc not found" || error.text === "kyc not started" || error.text === "kyc not approved"),
    },
  });
  const { data: legacyKYCStatus, refetch: refetchLegacyKYCStatus } = useQuery({
    queryKey: ["legacy", "kyc", "status"],
    queryFn: async () => getKYCStatus(LEGACY_KYC_TEMPLATE_ID),
    enabled: isKYCFetched && KYCStatus !== "ok",
    meta: {
      suppressError: (error) =>
        error instanceof APIError &&
        (error.text === "kyc not found" || error.text === "kyc not started" || error.text === "kyc not approved"),
    },
  });

  const { data: rateSnapshot, dataUpdatedAt: rateDataUpdatedAt } = useReadRatePreviewerSnapshot({
    address: ratePreviewerAddress,
  });

  const portfolio = useMemo(() => {
    if (!markets) return { depositMarkets: [], usdBalance: 0n };

    const depositMarkets: { market: string; symbol: string; usdValue: bigint }[] = [];
    let usdBalance = 0n;
    for (const { floatingDepositAssets, usdPrice, decimals, market, symbol } of markets) {
      if (floatingDepositAssets <= 0n) continue;
      const usdValue = (floatingDepositAssets * usdPrice) / 10n ** BigInt(decimals);
      if (usdValue <= 0n) continue;
      depositMarkets.push({ market, symbol: symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3), usdValue });
      usdBalance += usdValue;
    }

    return { usdBalance, depositMarkets };
  }, [markets]);

  const rates = useMemo(
    () => (rateSnapshot ? floatingDepositRates(rateSnapshot, Math.floor(rateDataUpdatedAt / 1000)) : []),
    [rateSnapshot, rateDataUpdatedAt],
  );

  const averageRate = useMemo(() => {
    const { depositMarkets, usdBalance } = portfolio;
    if (depositMarkets.length === 0 || usdBalance === 0n || rates.length === 0) return 0n;
    const rateByMarket = new Map(rates.map(({ market, rate }) => [market, rate]));

    let weightedRate = 0n;
    for (const { market, usdValue } of depositMarkets) {
      const rate = rateByMarket.get(market);
      if (rate === undefined || usdValue <= 0n) continue;
      weightedRate += rate * usdValue;
    }

    return weightedRate / usdBalance;
  }, [portfolio, rates]);

  const usdBalance = portfolio.usdBalance;
  const isPending = isPendingActivity || isPendingPreviewer;
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };
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
              style={style}
              refreshing={isPending}
              onRefresh={() => {
                refetchActivity().catch(reportError);
                refetchMarkets().catch(reportError);
                refetchKYCStatus().catch(reportError);
                refetchLegacyKYCStatus().catch(reportError);
                refetchPendingProposals().catch(reportError);
              }}
            />
          }
        >
          <ProfileHeader />
          <View flex={1}>
            <YStack backgroundColor="$backgroundSoft" padding="$s4" gap="$s4">
              {markets && healthFactor(markets) < HEALTH_FACTOR_THRESHOLD && <LiquidationAlert />}
              {(legacyKYCStatus === "ok" && KYCStatus !== "ok") ||
                (bytecode && !isLatestPlugin && (
                  <InfoAlert
                    title="We’re upgrading all Exa Cards by migrating them to a new and improved card issuer. Existing cards will work until May 18th, 2025, and upgrading will be required after this date."
                    actionText="Start Exa Card upgrade"
                    onPress={() => {
                      queryClient.setQueryData(["card-upgrade-open"], true);
                    }}
                  />
                ))}
              <YStack gap="$s8">
                <PortfolioSummary portfolio={portfolio} averageRate={averageRate} />
                <HomeActions />
              </YStack>
            </YStack>
            <View padded gap="$s5">
              <CardStatus
                onInfoPress={() => {
                  setSpendingLimitsInfoSheetOpen(true);
                }}
              />
              <GettingStarted hasFunds={usdBalance > 0n} hasKYC={KYCStatus === "ok"} />
              {bytecode && exploreDeFiShown && <ExploreDeFi />}
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
              <HomeDisclaimer />
            </View>
          </View>
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
        </ScrollView>
        <TimeToFullDisplay record={!!markets && !!activity} />
      </View>
    </SafeView>
  );
}

export const homeScrollReference = React.createRef<ScrollView>();
export const homeRefreshControlReference = React.createRef<RefreshControl>();
