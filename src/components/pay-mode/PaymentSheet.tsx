import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import {
  ArrowRight,
  Calendar,
  ChevronRight,
  CirclePercent,
  Coins,
  Info,
  RefreshCw,
  Siren,
} from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Separator, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { formatDistance, isAfter } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { digits, pipe, safeParse, string } from "valibot";
import { zeroAddress } from "viem";
import { optimismSepolia } from "viem/chains";
import { useBytecode } from "wagmi";

import chain, { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";
import { WAD } from "@exactly/lib";

import CalendarImage from "../../assets/images/calendar-rollover.svg";
import { presentArticle } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <SafeView
      paddingTop={0}
      fullScreen
      borderTopLeftRadius="$r4"
      borderTopRightRadius="$r4"
      backgroundColor="$backgroundMild"
    >
      {children}
    </SafeView>
  );
}

function NotAvailableView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Frame>
      <View padded paddingTop="$s6" fullScreen flex={1} justifyContent="center" alignItems="center" gap="$s4">
        <Text secondary body textAlign="center">
          {t("This payment is no longer available")}
        </Text>
        <Button secondary onPress={onClose}>
          <Button.Text>{t("Close")}</Button.Text>
        </Button>
      </View>
    </Frame>
  );
}

function RolloverIntroView({ isLatestPlugin, onContinue }: { isLatestPlugin: boolean; onContinue: () => void }) {
  const { t } = useTranslation();
  const toast = useToastController();
  return (
    <Frame>
      <View aspectRatio={2} justifyContent="center" alignItems="center">
        <View width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
          <CalendarImage width="100%" height="100%" />
        </View>
      </View>
      <Separator height={1} borderColor="$borderNeutralSoft" />
      <View padded paddingTop="$s6" fullScreen flex={1} backgroundColor="$backgroundMild">
        <YStack gap="$s7">
          <YStack gap="$s4_5">
            <Text primary emphasized title3>
              {t("Refinance your debt")}
            </Text>
            <Text secondary subHeadline>
              {t(
                "Roll over your debt to avoid penalties and gain more time to repay. It’s a smart way to manage your cash flow and possibly reduce your rate.",
              )}
            </Text>
          </YStack>
          <YStack gap="$s4">
            <XStack gap="$s3" alignItems="center" justifyContent="center">
              <Siren strokeWidth={2.5} color="$uiBrandSecondary" />
              <Text color="$uiBrandSecondary" emphasized headline>
                {t("Avoid penalties by extending your deadline")}
              </Text>
            </XStack>
            <XStack gap="$s3" alignItems="center" justifyContent="center">
              <CirclePercent strokeWidth={2.5} color="$uiBrandSecondary" />
              <Text color="$uiBrandSecondary" emphasized headline>
                {t("Refinance at a better rate")}
              </Text>
            </XStack>
            <XStack gap="$s3" alignItems="center" justifyContent="center">
              <Calendar strokeWidth={2.5} color="$uiBrandSecondary" />
              <Text color="$uiBrandSecondary" emphasized headline>
                {t("Get more time to repay")}
              </Text>
            </XStack>
          </YStack>
          <Button
            primary
            onPress={() => {
              if (!isLatestPlugin) {
                toast.show(t("Upgrade account to rollover"), {
                  native: true,
                  duration: 1000,
                  burntOptions: { haptic: "error", preset: "error" },
                });
                return;
              }
              queryClient.setQueryData<boolean>(["settings", "rollover-intro-shown"], true);
              onContinue();
            }}
          >
            <Button.Text>{t("Review refinance details")}</Button.Text>
            <Button.Icon>
              <ArrowRight color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />
            </Button.Icon>
          </Button>
        </YStack>
      </View>
    </Frame>
  );
}

function DetailsView({
  borrow,
  hidden,
  language,
  onRepayPress,
  onRolloverPress,
  onViewStatement,
}: {
  borrow: {
    discount: number;
    discountLabel: string;
    dueDate: Date;
    dueStatus: string;
    isUpcoming: boolean;
    positionValue: bigint;
    previewValue: bigint;
  };
  hidden: boolean;
  language: string;
  onRepayPress: () => void;
  onRolloverPress: () => void;
  onViewStatement: () => void;
}) {
  const { t } = useTranslation();
  const { previewValue, positionValue, discount, dueDate, isUpcoming, dueStatus, discountLabel } = borrow;
  return (
    <Frame>
      <View padded paddingTop="$s6" fullScreen flex={1}>
        <View gap="$s5">
          <XStack alignItems="center" justifyContent="center" gap="$s3" flex={1} flexWrap="wrap">
            <Text
              secondary
              textAlign="center"
              emphasized
              subHeadline
              color={isUpcoming ? "$uiNeutralSecondary" : "$uiErrorSecondary"}
            >
              {dueStatus}
              <Text secondary textAlign="center" emphasized subHeadline color="$uiNeutralSecondary">
                {" - "}
                {dueDate.toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" })}
              </Text>
            </Text>
            <Pressable
              onPress={() => {
                presentArticle("10245778").catch(reportError);
              }}
              hitSlop={15}
            >
              <Info size={16} color="$uiNeutralPrimary" />
            </Pressable>
          </XStack>
          <View flexDirection="column" justifyContent="center" alignItems="center" gap="$s4">
            <Text
              sensitive
              textAlign="center"
              fontFamily="$mono"
              fontSize={40}
              overflow="hidden"
              color={isUpcoming ? "$uiNeutralPrimary" : "$uiErrorSecondary"}
            >
              {`$${(Number(previewValue) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </Text>
            {discount >= 0 && (
              <Text sensitive body strikeThrough color="$uiNeutralSecondary">
                {`$${(Number(positionValue) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
            )}
            {!hidden && (
              <Text
                pill
                caption2
                padding="$s2"
                backgroundColor={
                  discount >= 0 ? "$interactiveBaseSuccessSoftDefault" : "$interactiveBaseErrorSoftDefault"
                }
                color={discount >= 0 ? "$uiSuccessSecondary" : "$uiErrorSecondary"}
              >
                {discountLabel}
              </Text>
            )}
          </View>
          <YStack gap={10} alignItems="center" paddingVertical={10} flex={1}>
            <XStack justifyContent="space-between" width="100%" gap={10}>
              <Button primary flex={1} onPress={onRepayPress}>
                <Button.Text>{t("Repay")}</Button.Text>
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
            <XStack flex={1} width="100%">
              <Button onPress={onViewStatement} outlined minHeight={46} borderColor="$borderNeutralSoft" flex={1}>
                <Button.Text emphasized footnote textTransform="uppercase">
                  {t("View Statement")}
                </Button.Text>
                <Button.Icon>
                  <ChevronRight color="$interactiveOnBaseBrandSoft" strokeWidth={2.5} />
                </Button.Icon>
              </Button>
            </XStack>
          </YStack>
        </View>
      </View>
    </Frame>
  );
}

export default function PaymentSheet() {
  const parameters = useLocalSearchParams<{ maturity?: string }>();
  const router = useRouter();
  const { maturity } = parameters;
  const { address } = useAccount();
  const { market: USDCMarket } = useAsset(marketUSDCAddress);
  const [rolloverIntroOpen, setRolloverIntroOpen] = useState(false);
  const [open, setOpen] = useState(() => !!maturity);
  const [displayMaturity, setDisplayMaturity] = useState(maturity);
  const toast = useToastController();
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const { data: rolloverIntroShown } = useQuery<boolean>({ queryKey: ["settings", "rollover-intro-shown"] });
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    query: { refetchOnMount: true, enabled: !!address && !!bytecode },
  });
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const dateFnsLocale = language === "es" ? es : enUS;
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  useEffect(() => {
    if (maturity) {
      setDisplayMaturity(maturity); // eslint-disable-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- sync from url param
      if (!open) setOpen(true); // eslint-disable-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- open sheet on maturity change
    }
  }, [maturity, open]);

  const borrow = useMemo<
    | undefined
    | {
        discount: number;
        discountLabel: string;
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
    if (!position) return;
    const previewValue = (position.previewValue * usdPrice) / 10n ** BigInt(decimals);
    const positionValue = ((position.position.principal + position.position.fee) * usdPrice) / 10n ** BigInt(decimals);
    const discount = Number(WAD - (previewValue * WAD) / positionValue) / 1e18;
    const dueDate = new Date(Number(displayMaturity) * 1000);
    const now = new Date();
    const isUpcoming = isAfter(dueDate, now);
    const timeDistance = formatDistance(isUpcoming ? now : dueDate, isUpcoming ? dueDate : now, {
      locale: dateFnsLocale,
    });
    const dueStatus = isUpcoming
      ? t("Due in {{time}}", { time: timeDistance })
      : t("{{time}} past due", { time: timeDistance });
    const discountPercentDisplay = (discount >= 0 ? discount : discount * -1).toLocaleString(language, {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const discountLabel =
      discount >= 0
        ? t("PAY NOW AND SAVE {{percent}}", { percent: discountPercentDisplay })
        : t("DAILY PENALTIES {{percent}}", { percent: discountPercentDisplay });
    return { discount, discountLabel, dueDate, dueStatus, isUpcoming, positionValue, previewValue };
  }, [displayMaturity, USDCMarket, dateFnsLocale, t, language]);

  const close = useCallback(() => {
    setRolloverIntroOpen(false);
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
    if (!rolloverIntroShown && !rolloverIntroOpen) {
      setRolloverIntroOpen(true);
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
  }, [rolloverIntroShown, rolloverIntroOpen, isLatestPlugin, close, router, displayMaturity, toast, t]);

  const renderContent = () => {
    if (!displayMaturity || !USDCMarket || !borrow) return <NotAvailableView onClose={close} />;
    if (rolloverIntroOpen) {
      return <RolloverIntroView isLatestPlugin={isLatestPlugin} onContinue={navigateToRollover} />;
    }
    return (
      <DetailsView
        borrow={borrow}
        hidden={!!hidden}
        language={language}
        onRepayPress={navigateToRepay}
        onRolloverPress={navigateToRollover}
        onViewStatement={viewStatement}
      />
    );
  };

  return (
    <ModalSheet open={open} onClose={close}>
      {renderContent()}
    </ModalSheet>
  );
}
