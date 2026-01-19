import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ScrollView, YStack } from "tamagui";

import { TimeToFullDisplay } from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

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
import { KYC_TEMPLATE_ID, LEGACY_KYC_TEMPLATE_ID } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, getActivity, getKYCStatus, type CardDetails } from "../../utils/server";
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

const HEALTH_FACTOR_THRESHOLD = (WAD * 11n) / 10n;

export default function Home() {
  const parameters = useLocalSearchParams();
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [paySheetOpen, setPaySheetOpen] = useState(false);
  const [spendingLimitsInfoSheetOpen, setSpendingLimitsInfoSheetOpen] = useState(false);
  const [visaSignatureModalOpen, setVisaSignatureModalOpen] = useState(false);

  const { address: account } = useAccount();
  const { data: bytecode, refetch: refetchBytecode } = useBytecode({
    address: account ?? zeroAddress,
    query: { enabled: !!account },
  });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account ?? zeroAddress,
    query: { enabled: !!account && !!bytecode },
  });
  const { portfolio, averageRate } = usePortfolio(account);

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
    args: [account ?? zeroAddress],
    query: { enabled: !!account && !!bytecode, gcTime: 0, refetchInterval: 30_000 },
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
  const {
    data: legacyKYCStatus,
    isFetched: isLegacyKYCFetched,
    refetch: refetchLegacyKYCStatus,
  } = useQuery({
    queryKey: ["legacy", "kyc", "status"],
    queryFn: async () => getKYCStatus(LEGACY_KYC_TEMPLATE_ID),
    enabled: isKYCFetched && KYCStatus !== "ok",
    meta: {
      suppressError: (error) =>
        error instanceof APIError &&
        (error.text === "kyc not found" || error.text === "kyc not started" || error.text === "kyc not approved"),
    },
  });
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"], enabled: !!account && !!bytecode });

  const scrollRef = useRef<ScrollView>(null);
  const refresh = () => {
    refetchActivity().catch(reportError);
    refetchBytecode().catch(reportError);
    refetchMarkets().catch(reportError);
    refetchKYCStatus().catch(reportError);
    refetchLegacyKYCStatus().catch(reportError);
    refetchPendingProposals().catch(reportError);
  };
  useTabPress("index", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    refresh();
  });

  const usdBalance = portfolio.usdBalance;
  const isPending = isPendingActivity || isPendingPreviewer;
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <ScrollView
          ref={scrollRef}
          backgroundColor="transparent"
          contentContainerStyle={{ backgroundColor: "$backgroundMild" }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isPending} onRefresh={refresh} />}
        >
          <ProfileHeader />
          <View flex={1}>
            <YStack backgroundColor="$backgroundSoft" padding="$s4" gap="$s4">
              {markets && healthFactor(markets) < HEALTH_FACTOR_THRESHOLD && <LiquidationAlert />}
              {((isKYCFetched && isLegacyKYCFetched && legacyKYCStatus === "ok" && KYCStatus !== "ok") ||
                (!!bytecode && !!installedPlugins && !isLatestPlugin)) && (
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
                <PortfolioSummary portfolio={portfolio} averageRate={averageRate} />
                <HomeActions />
              </YStack>
            </YStack>
            <View padded gap="$s5">
              {card && (
                <CardStatus
                  onInfoPress={() => {
                    setSpendingLimitsInfoSheetOpen(true);
                  }}
                  productId={card.productId}
                />
              )}
              {card?.productId === PLATINUM_PRODUCT_ID && (
                <VisaSignatureBanner
                  onPress={() => {
                    setVisaSignatureModalOpen(true);
                  }}
                />
              )}
              <GettingStarted hasFunds={usdBalance > 0n} hasKYC={KYCStatus === "ok"} />
              {KYCStatus === "ok" && <BenefitsSection />}
              <OverduePayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: String(maturity) });
                  setPaySheetOpen(true);
                }}
              />
              <UpcomingPayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: String(maturity) });
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
              router.setParams({ ...parameters, maturity: undefined });
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
