import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { Coins, ExternalLink, FileText, Info, RefreshCw } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { XStack, YStack, type YStackProps } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceStrict, isAfter } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { digits, pipe, safeParse, string } from "valibot";
import { optimismSepolia } from "viem/chains";

import accountInit from "@exactly/common/accountInit";
import chain, { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";
import { WAD } from "@exactly/lib";

import { presentArticle } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import Amount from "../shared/Amount";
import InfoSheet from "../shared/InfoSheet";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

import type { Credential } from "@exactly/common/validation";

export default function PaymentSheet({ onRolloverIntro }: { onRolloverIntro?: (maturity: string) => void }) {
  const parameters = useLocalSearchParams<{ maturity?: string }>();
  const router = useRouter();
  const { maturity } = parameters;
  const { address } = useAccount();
  const toast = useToastController();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { refetchOnMount: true, enabled: !!address && !!credential },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const { market: USDCMarket } = useAsset(marketUSDCAddress);
  const [infoOpen, setInfoOpen] = useState(false);
  const [open, setOpen] = useState(() => !!maturity);
  const [displayMaturity, setDisplayMaturity] = useState(maturity);
  const { data: rolloverIntroShown } = useQuery<boolean>({ queryKey: ["settings", "rollover-intro-shown"] });
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const dateFnsLocale = language === "es" ? es : enUS;

  if (maturity && !open) {
    setDisplayMaturity(maturity);
    setOpen(true);
  }

  const borrow = useMemo<
    | undefined
    | {
        discount: number;
        dueDate: Date;
        dueStatus: string;
        isUpcoming: boolean;
        positionValue: bigint;
        previewValue: bigint;
      }
  >(() => {
    if (!USDCMarket) return;
    const { success, output: maturityValue } = safeParse(pipe(string(), digits()), displayMaturity);
    if (!success) return;
    const { fixedBorrowPositions, usdPrice, decimals } = USDCMarket;
    const position = fixedBorrowPositions.find((b) => b.maturity === BigInt(maturityValue));
    if (!position || position.previewValue === 0n || position.position.principal + position.position.fee === 0n) return;
    const previewValue = (position.previewValue * usdPrice) / 10n ** BigInt(decimals);
    const positionValue = ((position.position.principal + position.position.fee) * usdPrice) / 10n ** BigInt(decimals);
    const discount = Number(WAD - (previewValue * WAD) / positionValue) / 1e18;
    const dueDate = new Date(Number(displayMaturity) * 1000);
    const now = new Date();
    const isUpcoming = isAfter(dueDate, now);
    const timeDistance = formatDistanceStrict(isUpcoming ? now : dueDate, isUpcoming ? dueDate : now, {
      locale: dateFnsLocale,
    });
    const dueStatus = isUpcoming
      ? t("Due in {{time}}", { time: timeDistance })
      : t("{{time}} past due", { time: timeDistance });
    return { discount, dueDate, dueStatus, isUpcoming, positionValue, previewValue };
  }, [displayMaturity, USDCMarket, dateFnsLocale, t]);

  const close = useCallback(() => {
    setInfoOpen(false);
    setOpen(false);
    router.setParams({ ...parameters, maturity: undefined });
  }, [parameters, router]);

  const viewStatement = useCallback(() => {
    openBrowser(
      `https://${
        {
          [optimismSepolia.id]: "testnet",
        }[chain.id] ?? "app"
      }.exact.ly/dashboard?account=${address}&tab=b`,
    ).catch(reportError);
  }, [address]);

  const navigateToRepay = useCallback(() => {
    close();
    router.navigate({ pathname: "/pay", params: { maturity: displayMaturity } });
  }, [close, router, displayMaturity]);

  const navigateToRollover = useCallback(() => {
    if (!rolloverIntroShown && onRolloverIntro && displayMaturity) {
      close();
      onRolloverIntro(displayMaturity);
      return;
    }
    if (!isLatestPlugin) {
      toast.show(t("Upgrade account to rollover"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
      return;
    }
    close();
    router.navigate({ pathname: "/roll-debt", params: { maturity: displayMaturity } });
  }, [rolloverIntroShown, onRolloverIntro, displayMaturity, close, router, isLatestPlugin, toast, t]);

  const renderContent = () => {
    if (!displayMaturity || !USDCMarket || !borrow) return <NotAvailableView onClose={close} />;
    return (
      <DetailsView
        borrow={borrow}
        language={language}
        onInfoPress={() => setInfoOpen(true)}
        onRepayPress={navigateToRepay}
        onRolloverPress={navigateToRollover}
        onViewStatement={viewStatement}
      />
    );
  };

  return (
    <>
      <ModalSheet open={open} onClose={close}>
        {renderContent()}
      </ModalSheet>
      {borrow && (
        <InfoSheet
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          title={borrow.isUpcoming ? t("Early repayment discount") : t("Late payment fees")}
        >
          {borrow.isUpcoming ? (
            <Text body color="$uiNeutralSecondary">
              {t(
                "You can repay early and save on interest. The final amount updates automatically before you confirm.",
              )}
            </Text>
          ) : (
            <>
              <Text body color="$uiNeutralSecondary">
                {t(
                  "Late fees are charged daily after the due date. The rate applies to your full balance (principal + interest) and keeps adding up until you pay.",
                )}
              </Text>
              <Text emphasized body color="$uiNeutralSecondary">
                {t("Example: On a $100 balance, a 0.45% daily fee adds $0.45 per day.")}
              </Text>
            </>
          )}
          <Button
            primary
            onPress={() => {
              presentArticle("10245778").catch(reportError);
            }}
          >
            <Button.Text>{t("Learn more")}</Button.Text>
            <Button.Icon>
              <ExternalLink color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />
            </Button.Icon>
          </Button>
          <Text
            footnote
            emphasized
            color="$interactiveTextBrandDefault"
            cursor="pointer"
            textAlign="center"
            onPress={() => setInfoOpen(false)}
          >
            {t("Close")}
          </Text>
        </InfoSheet>
      )}
    </>
  );
}

function Frame({ children, ...properties }: YStackProps & { children: React.ReactNode }) {
  return (
    <YStack
      borderTopLeftRadius="$r5"
      borderTopRightRadius="$r5"
      backgroundColor="$backgroundSoft"
      paddingTop="$s5"
      paddingHorizontal="$s5"
      paddingBottom="$s7"
      {...properties}
    >
      {children}
    </YStack>
  );
}

function NotAvailableView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Frame>
      <YStack
        flex={1}
        justifyContent="center"
        alignItems="center"
        gap="$s4"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
      >
        <Text secondary body textAlign="center">
          {t("This payment is no longer available")}
        </Text>
        <Button secondary onPress={onClose}>
          <Button.Text>{t("Close")}</Button.Text>
        </Button>
      </YStack>
    </Frame>
  );
}

function DetailsView({
  borrow,
  language,
  onInfoPress,
  onRepayPress,
  onRolloverPress,
  onViewStatement,
}: {
  borrow: {
    discount: number;
    dueDate: Date;
    dueStatus: string;
    isUpcoming: boolean;
    positionValue: bigint;
    previewValue: bigint;
  };
  language: string;
  onInfoPress: () => void;
  onRepayPress: () => void;
  onRolloverPress: () => void;
  onViewStatement: () => void;
}) {
  const { t } = useTranslation();
  const { previewValue, positionValue, discount, dueDate, isUpcoming, dueStatus } = borrow;

  const penaltyPercent = Math.abs(discount);
  const originalAmount = Number(positionValue) / 1e18;

  return (
    <Frame>
      <YStack backgroundColor="$backgroundSoft" gap="$s5">
        <YStack gap="$s1">
          <XStack gap="$s3" alignItems="center">
            <XStack gap="$s2" alignItems="center" flex={1}>
              <Text emphasized headline flexShrink={1} color={isUpcoming ? "$uiNeutralPrimary" : "$uiErrorSecondary"}>
                {dueStatus}
              </Text>
            </XStack>
            <XStack flexShrink={0} gap="$s1" alignItems="center" cursor="pointer" onPress={onViewStatement}>
              <Text emphasized footnote color="$interactiveBaseBrandDefault">
                {t("View statement")}
              </Text>
              <FileText size={16} color="$interactiveBaseBrandDefault" />
            </XStack>
          </XStack>
          <Text caption color="$uiNeutralSecondary">
            {dueDate.toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" })}
            {` - ${dueDate.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`}
          </Text>
        </YStack>
        <XStack gap="$s3_5" alignItems="center">
          <Amount amount={Number(previewValue) / 1e18} status={isUpcoming ? "success" : "danger"} flex={1} />
          <YStack alignItems="flex-end" gap="$s3">
            {isUpcoming ? (
              discount >= 0.001 ? (
                <>
                  <Text sensitive body strikeThrough color="$uiNeutralSecondary">
                    {`$${originalAmount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </Text>
                  <Text emphasized subHeadline color="$uiSuccessSecondary">
                    {t("{{percent}} OFF", {
                      percent: discount.toLocaleString(language, {
                        style: "percent",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </Text>
                </>
              ) : null
            ) : (
              <>
                <Text sensitive body color="$uiErrorSecondary">
                  {penaltyPercent.toLocaleString(language, {
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
                <Text emphasized subHeadline color="$uiErrorSecondary">
                  {t("Late payment fee")}
                </Text>
              </>
            )}
          </YStack>
          <Pressable onPress={onInfoPress} hitSlop={15}>
            <Info size={16} color="$interactiveBaseBrandDefault" />
          </Pressable>
        </XStack>
        <YStack>
          <XStack gap="$s3">
            <Button primary flex={1} onPress={onRepayPress}>
              <Button.Text>{t("Pay")}</Button.Text>
              <Button.Icon>
                <Coins color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />
              </Button.Icon>
            </Button>
            <Button secondary flex={1} onPress={onRolloverPress}>
              <Button.Text>{t("Rollover")}</Button.Text>
              <Button.Icon>
                <RefreshCw color="$interactiveOnBaseBrandSoft" strokeWidth={2.5} />
              </Button.Icon>
            </Button>
          </XStack>
        </YStack>
      </YStack>
    </Frame>
  );
}
