import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl } from "react-native";

import { useRouter } from "expo-router";

import { AnimatePresence, ScrollView, YStack } from "tamagui";

import { TimeToFullDisplay } from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";
import { useBytecode } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import { exaPluginAddress, exaPreviewerAddress, previewerAddress } from "@exactly/common/generated/chain";
import {
  useReadExaPreviewerPendingProposals,
  useReadPreviewerExactly,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";
import { PLATINUM_PRODUCT_ID } from "@exactly/common/panda";
import { healthFactor, WAD } from "@exactly/lib";

import CardUpgradeSheet from "./card-upgrade/CardUpgradeSheet";
import CardStatus from "./CardStatus";
import GettingStarted from "./GettingStarted";
import HomeActions from "./HomeActions";
import HomeDisclaimer from "./HomeDisclaimer";
import PortfolioSummary from "./PortfolioSummary";
import SpendingLimitsSheet from "./SpendingLimitsSheet";
import VisaSignatureBanner from "./VisaSignatureBanner";
import VisaSignatureModal from "./VisaSignatureSheet";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePortfolio from "../../utils/usePortfolio";
import useTabPress from "../../utils/useTabPress";
import BenefitsSection from "../benefits/BenefitsSection";
import OverduePayments from "../pay-mode/OverduePayments";
import PaymentSheet from "../pay-mode/PaymentSheet";
import UpcomingPayments from "../pay-mode/UpcomingPayments";
import InfoAlert from "../shared/InfoAlert";
import LatestActivity from "../shared/LatestActivity";
import LiquidationAlert from "../shared/LiquidationAlert";
import ProfileHeader from "../shared/ProfileHeader";
import SafeView from "../shared/SafeView";
import View from "../shared/View";

import type { ActivityItem } from "../../utils/queryClient";
import type { CardDetails, KYCStatus } from "../../utils/server";
import type { Credential } from "@exactly/common/validation";

const HEALTH_FACTOR_THRESHOLD = (WAD * 11n) / 10n;

export default function Home() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [spendingLimitsInfoSheetOpen, setSpendingLimitsInfoSheetOpen] = useState(false);
  const [visaSignatureModalOpen, setVisaSignatureModalOpen] = useState(false);

  const { address: account } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: bytecode, refetch: refetchBytecode } = useBytecode({
    address: account,
    query: { enabled: !!account },
  });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!account && !!credential },
  });
  const {
    portfolio: { balanceUSD },
    averageRate,
    assets,
    totalBalanceUSD,
  } = usePortfolio();

  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const { data: cardUpgradeOpen } = useQuery<boolean>({
    initialData: false,
    queryKey: ["card-upgrade-open"],
    queryFn: () => {
      return false;
    },
  });
  const { refetch: refetchPendingProposals } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: account ? [account] : undefined,
    query: { enabled: !!account && !!bytecode, gcTime: 0, refetchInterval: 30_000 },
  });
  const { data: activity, isFetching: isFetchingActivity } = useQuery<ActivityItem[]>({ queryKey: ["activity"] });
  const {
    data: markets,
    refetch: refetchMarkets,
    isFetching: isFetchingPreviewer,
  } = useReadPreviewerExactly({
    address: previewerAddress,
    args: account ? [account] : undefined,
    query: { enabled: !!account },
  });
  const {
    data: kycStatus,
    isFetched: isKYCFetched,
    isFetching: isFetchingKYC,
  } = useQuery<KYCStatus>({ queryKey: ["kyc", "status"] });
  const needsMigration = Boolean(kycStatus && "code" in kycStatus && kycStatus.code === "legacy kyc");
  const isKYCApproved = Boolean(
    kycStatus && "code" in kycStatus && (kycStatus.code === "ok" || kycStatus.code === "legacy kyc"),
  );
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"], enabled: !!account && !!bytecode });

  const scrollRef = useRef<ScrollView>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["activity"], exact: true }).catch(reportError);
    queryClient.invalidateQueries({ queryKey: ["kyc", "status"], exact: true }).catch(reportError);
    if (account) refetchMarkets().catch(reportError);
    if (account) refetchBytecode().catch(reportError);
    if (account && bytecode) refetchPendingProposals().catch(reportError);
  };
  useTabPress("index", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    refresh();
  });

  const isFetching = isFetchingActivity || isFetchingPreviewer || isFetchingKYC;
  const showKYCMigration = isKYCFetched && needsMigration;
  const showPluginOutdated = !!bytecode && !!installedPlugins && !isLatestPlugin;
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <ScrollView
          ref={scrollRef}
          backgroundColor="transparent"
          contentContainerStyle={{ backgroundColor: "$backgroundMild" }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refresh} />}
        >
          <ProfileHeader />
          <View flex={1}>
            <YStack backgroundColor="$backgroundSoft" padding="$s4" gap="$s4">
              {markets && healthFactor(markets) < HEALTH_FACTOR_THRESHOLD && <LiquidationAlert />}
              {(showKYCMigration || showPluginOutdated) && (
                <InfoAlert
                  title={t(
                    "We're upgrading all Exa Cards by migrating them to a new and improved card issuer. Existing cards will work until {{deadline}}, and upgrading will be required after this date.",
                    {
                      deadline: new Date(2025, 4, 18).toLocaleDateString(language, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      }),
                    },
                  )}
                  actionText={t("Start Exa Card upgrade")}
                  onPress={() => {
                    queryClient.setQueryData(["card-upgrade-open"], true);
                  }}
                />
              )}
              <YStack gap="$s8">
                <PortfolioSummary
                  balanceUSD={balanceUSD}
                  averageRate={averageRate}
                  assets={assets}
                  totalBalanceUSD={totalBalanceUSD}
                />
                <HomeActions />
              </YStack>
            </YStack>
            <View padded gap="$s5">
              <AnimatePresence>
                {card && (
                  <CardStatus
                    onInfoPress={() => {
                      setSpendingLimitsInfoSheetOpen(true);
                    }}
                    productId={card.productId}
                  />
                )}
              </AnimatePresence>
              {card?.productId === PLATINUM_PRODUCT_ID && (
                <VisaSignatureBanner
                  onPress={() => {
                    setVisaSignatureModalOpen(true);
                  }}
                />
              )}
              <AnimatePresence>
                {isKYCFetched && (!isKYCApproved || !bytecode) && (
                  <GettingStarted isDeployed={!!bytecode} hasKYC={isKYCApproved} />
                )}
              </AnimatePresence>
            </View>
            {isKYCFetched && isKYCApproved && <BenefitsSection />}
            <View padded gap="$s5">
              <OverduePayments onSelect={(m) => router.setParams({ maturity: String(m) })} />
              <UpcomingPayments onSelect={(m) => router.setParams({ maturity: String(m) })} />
              <LatestActivity activity={activity} />
              <HomeDisclaimer />
            </View>
          </View>
          <PaymentSheet />
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
          <VisaSignatureModal
            open={visaSignatureModalOpen}
            onClose={() => {
              setVisaSignatureModalOpen(false);
            }}
          />
        </ScrollView>
        <TimeToFullDisplay record={!!markets && !!activity} />
      </View>
    </SafeView>
  );
}
