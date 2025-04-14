import { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";
import { Coins, Info, RefreshCw } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistance, isAfter } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { XStack } from "tamagui";
import { titleCase } from "title-case";
import { nonEmpty, pipe, safeParse, string } from "valibot";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import { useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PaymentSheetContent({ onClose }: { onClose: (displayIntro?: boolean) => void }) {
  const toast = useToastController();
  const { presentArticle } = useIntercom();
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const { data: rolloverIntroShown } = useQuery<boolean>({ queryKey: ["settings", "rollover-intro-shown"] });
  const { market: USDCMarket, account: address } = useAsset(marketUSDCAddress);
  const { maturity: currentMaturity } = useLocalSearchParams();
  const { success, output: maturity } = safeParse(pipe(string(), nonEmpty("no maturity")), currentMaturity);
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    query: { refetchOnMount: true, enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  if (!success || !USDCMarket) return;
  const { fixedBorrowPositions, usdPrice, decimals } = USDCMarket;
  const borrow = fixedBorrowPositions.find((b) => b.maturity === BigInt(maturity));
  if (!borrow) return;
  const previewValue = (borrow.previewValue * usdPrice) / 10n ** BigInt(decimals);
  const positionValue = ((borrow.position.principal + borrow.position.fee) * usdPrice) / 10n ** BigInt(decimals);
  const discount = Number(WAD - (previewValue * WAD) / positionValue) / 1e18;

  return (
    <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
      <View padded paddingTop="$s6" fullScreen flex={1}>
        <>
          <View gap="$s5">
            <XStack alignItems="center" justifyContent="center" gap="$s3">
              <Text
                secondary
                textAlign="center"
                emphasized
                subHeadline
                color={
                  isAfter(new Date(Number(maturity) * 1000), new Date()) ? "$uiNeutralSecondary" : "$uiErrorSecondary"
                }
              >
                {titleCase(
                  isAfter(new Date(Number(maturity) * 1000), new Date())
                    ? `Due in ${formatDistance(new Date(), new Date(Number(maturity) * 1000))}`
                    : `${formatDistance(new Date(Number(maturity) * 1000), new Date())} past due`,
                )}
                <Text secondary textAlign="center" emphasized subHeadline color="$uiNeutralSecondary">
                  &nbsp;-&nbsp;{format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}
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
                color={
                  isAfter(new Date(Number(maturity) * 1000), new Date()) ? "$uiNeutralPrimary" : "$uiErrorSecondary"
                }
              >
                {(Number(previewValue) / 1e18).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  currencyDisplay: "narrowSymbol",
                })}
              </Text>
              {discount >= 0 && (
                <Text sensitive body strikeThrough color="$uiNeutralSecondary">
                  {(Number(positionValue) / 1e18).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
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
                  {discount >= 0 ? "PAY NOW AND SAVE " : "DAILY PENALTIES "}
                  {(discount >= 0 ? discount : discount * -1).toLocaleString(undefined, {
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              )}
            </View>
            <View
              flexDirection="row"
              display="flex"
              gap={10}
              justifyContent="center"
              alignItems="center"
              paddingVertical={10}
            >
              <Button
                onPress={() => {
                  onClose();
                  router.push({ pathname: "/pay", params: { maturity: maturity.toString() } });
                }}
                contained
                main
                spaced
                halfWidth
                iconAfter={<Coins color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />}
              >
                Repay
              </Button>
              <Button
                main
                spaced
                halfWidth
                outlined
                backgroundColor="$interactiveBaseBrandSoftDefault"
                color="$interactiveOnBaseBrandSoft"
                iconAfter={<RefreshCw color="$interactiveOnBaseBrandSoft" strokeWidth={2.5} />}
                onPress={() => {
                  if (!rolloverIntroShown) {
                    onClose(true);
                    return;
                  }
                  if (!isLatestPlugin) {
                    toast.show("Upgrade account to rollover", {
                      native: true,
                      duration: 1000,
                      burntOptions: { haptic: "error", preset: "error" },
                    });
                    return;
                  }
                  onClose();
                  router.push({
                    pathname: "/roll-debt",
                    params: { maturity: maturity.toString() },
                  });
                }}
              >
                Rollover
              </Button>
            </View>
          </View>
        </>
      </View>
    </SafeView>
  );
}
