import { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";
import { ArrowRight, Calendar, CirclePercent, Coins, Info, RefreshCw, Siren } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistance, isAfter } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Separator, Sheet, XStack, YStack } from "tamagui";
import { titleCase } from "title-case";
import { nonEmpty, pipe, safeParse, string } from "valibot";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import CalendarImage from "../../assets/images/calendar-rollover.svg";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PaymentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount();
  const { presentArticle } = useIntercom();
  const { market: USDCMarket } = useAsset(marketUSDCAddress);
  const { maturity: currentMaturity } = useLocalSearchParams();
  const [rolloverIntroOpen, setRolloverIntroOpen] = useState(false);
  const { success, output: maturity } = safeParse(pipe(string(), nonEmpty("no maturity")), currentMaturity);
  const toast = useToastController();
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const { data: rolloverIntroShown } = useQuery<boolean>({ queryKey: ["settings", "rollover-intro-shown"] });
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
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={() => {
        setRolloverIntroOpen(false);
        onClose();
      }}
      snapPointsMode="fit"
      zIndex={100_000}
      modal
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Handle />
      <Sheet.Frame>
        <SafeView
          paddingTop={0}
          fullScreen
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundMild"
        >
          {rolloverIntroOpen ? (
            <>
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
                      Refinance your debt
                    </Text>
                    <Text secondary subHeadline>
                      Roll over your debt to avoid penalties and gain more time to repay. It’s a smart way to manage
                      your cash flow and possibly reduce your rate.
                    </Text>
                  </YStack>
                  <YStack gap="$s4">
                    <XStack gap="$s3" alignItems="center" justifyContent="center">
                      <Siren strokeWidth={2.5} color="$uiBrandSecondary" />
                      <Text color="$uiBrandSecondary" emphasized headline>
                        Avoid penalties by extending your deadline
                      </Text>
                    </XStack>
                    <XStack gap="$s3" alignItems="center" justifyContent="center">
                      <CirclePercent strokeWidth={2.5} color="$uiBrandSecondary" />
                      <Text color="$uiBrandSecondary" emphasized headline>
                        Refinance at a better rate
                      </Text>
                    </XStack>
                    <XStack gap="$s3" alignItems="center" justifyContent="center">
                      <Calendar strokeWidth={2.5} color="$uiBrandSecondary" />
                      <Text color="$uiBrandSecondary" emphasized headline>
                        Get more time to repay
                      </Text>
                    </XStack>
                  </YStack>
                  <Button
                    contained
                    main
                    spaced
                    halfWidth
                    iconAfter={<ArrowRight color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />}
                    onPress={() => {
                      if (!isLatestPlugin) {
                        toast.show("Upgrade account to rollover", {
                          native: true,
                          duration: 1000,
                          burntOptions: { haptic: "error", preset: "error" },
                        });
                        return;
                      }
                      onClose();
                      queryClient.setQueryData<boolean>(["settings", "rollover-intro-shown"], true);
                      router.push({
                        pathname: "/roll-debt",
                        params: { maturity: maturity.toString() },
                      });
                    }}
                  >
                    Review refinance details
                  </Button>
                </YStack>
              </View>
            </>
          ) : (
            <>
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
                          isAfter(new Date(Number(maturity) * 1000), new Date())
                            ? "$uiNeutralSecondary"
                            : "$uiErrorSecondary"
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
                          isAfter(new Date(Number(maturity) * 1000), new Date())
                            ? "$uiNeutralPrimary"
                            : "$uiErrorSecondary"
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
                            setRolloverIntroOpen(true);
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
            </>
          )}
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}
