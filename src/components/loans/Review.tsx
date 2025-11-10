import type { BatchUserOperationCallData } from "@alchemy/aa-core";
import ProposalType from "@exactly/common/ProposalType";
import { exaPluginAddress, marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import {
  exaPluginAbi,
  upgradeableModularAccountAbi,
  useReadPreviewerPreviewBorrowAtMaturity,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";
import shortenHex from "@exactly/common/shortenHex";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, X } from "@tamagui/lucide-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useNavigation } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { ScrollView, Separator, Square, XStack, YStack } from "tamagui";
import { encodeAbiParameters, encodeFunctionData, maxUint256, zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import { accountClient } from "../../utils/alchemyConnector";
import assetLogos from "../../utils/assetLogos";
import { presentArticle } from "../../utils/intercom";
import type { Loan } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import AssetLogo from "../shared/AssetLogo";
import GradientScrollView from "../shared/GradientScrollView";
import PaymentScheduleSheet from "../shared/PaymentScheduleSheet";
import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Review() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { t } = useTranslation();
  const { address } = useAccount();
  const [paymentScheduleShown, setPaymentScheduleShown] = useState(false);
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const {
    amount,
    installments: count,
    maturity,
    market,
    receiver,
  } = loan ?? {
    amount: 0n,
    installments: 0,
    maturity: 0n,
    market: zeroAddress,
    receiver: "",
  };
  const { market: assetMarket, isFetching: isAssetPending } = useAsset(market);

  const symbol = assetMarket?.symbol.slice(3) === "WETH" ? "ETH" : assetMarket?.symbol.slice(3);
  const singleInstallment = count === 1;

  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });

  const { data: borrow, isPending: isBorrowPending } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [marketUSDCAddress, maturity ?? 0n, amount ?? 0n],
    query: { enabled: !!address && !!bytecode && !!maturity && !!amount && singleInstallment },
  });

  const { data: split, isFetching: isInstallmentsPending } = useInstallments({
    totalAmount: amount ?? 0n,
    installments: count ?? 0,
    marketAddress: market,
    timestamp: Number(maturity),
  });

  const installmentsAmount = singleInstallment
    ? (borrow?.assets ?? 0n)
    : split
      ? split.installments.reduce((accumulator, current) => accumulator + current, 0n) /
        BigInt(split.installments.length)
      : 0n;

  const totalAmount = borrow
    ? borrow.assets
    : split
      ? split.installments.reduce((accumulator, current) => accumulator + current, 0n)
      : 0n;

  const feeAmount = borrow
    ? borrow.assets - (amount ?? 0n)
    : split
      ? split.installments.reduce((accumulator, current) => accumulator + current, 0n) - (amount ?? 0n)
      : 0n;

  const {
    mutateAsync: propose,
    isPending: isProposingBorrowInstallments,
    isSuccess: isProposingBorrowInstallmentsSuccess,
    error: proposeBorrowInstallmentsError,
  } = useMutation({
    async mutationFn() {
      if (!address) throw new Error("no account");
      if (!market) throw new Error("no market");
      if (!receiver) throw new Error("no receiver");
      if (!singleInstallment && !split) throw new Error("no installment data");
      if (!accountClient) throw new Error("no account client");
      const uo: BatchUserOperationCallData = [];
      for (let index = 0; index < (count ?? 0); index++) {
        const borrowAmount = singleInstallment ? amount : split?.amounts[index];
        const borrowMaturity = BigInt(Number(loan?.maturity) + index * MATURITY_INTERVAL);
        if (!borrowAmount) return;
        const data = encodeFunctionData({
          functionName: "propose",
          abi: [...upgradeableModularAccountAbi, ...exaPluginAbi],
          args: [
            market,
            borrowAmount,
            ProposalType.BorrowAtMaturity,
            encodeAbiParameters(
              [
                { name: "maturity", internalType: "uint256", type: "uint256" },
                { name: "maxAssets", internalType: "uint256", type: "uint256" },
                { name: "receiver", internalType: "address", type: "address" },
              ],
              [borrowMaturity, maxUint256, receiver],
            ),
          ],
        });
        uo.push({ target: address, data });
      }
      const userOperation = await accountClient.sendUserOperation({ uo });
      return await accountClient.waitForUserOperationTransaction(userOperation);
    },
    onError: reportError,
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const rate = borrow
    ? Number(
        ((borrow.assets - (amount ?? 0n)) * WAD * 31_536_000n) /
          ((amount ?? 0n) * (borrow.maturity - BigInt(timestamp))),
      ) / 1e18
    : split
      ? Number(split.effectiveRate) / 1e18
      : 0;

  const pending = isAssetPending || (singleInstallment ? isBorrowPending : isInstallmentsPending);
  const processing = isProposingBorrowInstallments;
  const success = isProposingBorrowInstallmentsSuccess;
  const error = !!proposeBorrowInstallmentsError;
  const disabled = pending;

  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  if (!processing && !error && !success) {
    return (
      <SafeView fullScreen>
        <View
          padded
          flexDirection="row"
          gap={10}
          paddingBottom="$s4"
          justifyContent="space-between"
          alignItems="center"
        >
          <Pressable
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
                return;
              }
              navigation.replace("loan", { screen: "receiver" });
            }}
          >
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <Pressable
            onPress={() => {
              presentArticle("11541409").catch(reportError);
            }}
          >
            <CircleHelp color="$uiNeutralPrimary" />
          </Pressable>
        </View>
        <ScrollView
          backgroundColor="$backgroundMild"
          showsVerticalScrollIndicator={false}
          // eslint-disable-next-line react-native/no-inline-styles
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
            <YStack gap="$s4">
              <Text primary emphasized body>
                Review terms
              </Text>
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  {`You ${receiver === address ? "receive" : "send"}`}
                </Text>
                <XStack alignItems="center" gap="$s2">
                  <AssetLogo
                    height={16}
                    source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                    width={16}
                  />
                  <Text title3 color="$uiNeutralPrimary">
                    {(Number(amount ?? 0n) / 1e6).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                </XStack>
              </XStack>
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  {`Fixed ${rate.toLocaleString(undefined, {
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} APR`}
                </Text>
                <XStack alignItems="center" gap="$s2">
                  <AssetLogo
                    height={16}
                    source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                    width={16}
                  />
                  <Text title3 color="$uiNeutralPrimary">
                    {(Number(feeAmount) / 1e6).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                </XStack>
              </XStack>
              <Separator height={1} borderColor="$borderNeutralSoft" />
              <YStack>
                <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                  <Text footnote color="$uiNeutralSecondary">
                    {t("You repay {{count}} installments of", { count })}
                  </Text>
                  <XStack alignItems="center" gap="$s2">
                    <XStack alignItems="center" gap="$s2">
                      <AssetLogo
                        height={16}
                        source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                        width={16}
                      />
                      <Text title3 color="$uiNeutralPrimary">
                        {(Number(singleInstallment ? totalAmount : installmentsAmount) / 1e6).toLocaleString(
                          undefined,
                          { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                        )}
                      </Text>
                    </XStack>
                  </XStack>
                </XStack>
                {singleInstallment ? null : (
                  <XStack gap="$s4" alignItems="center" justifyContent="flex-end">
                    <Text footnote color="$uiNeutralSecondary">
                      each
                    </Text>
                  </XStack>
                )}
              </YStack>
              {singleInstallment ? null : (
                <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                  <Text footnote color="$uiNeutralSecondary">
                    Total
                  </Text>
                  <XStack alignItems="center" gap="$s2">
                    <AssetLogo
                      height={16}
                      source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                      width={16}
                    />
                    <Text title3 color="$uiNeutralPrimary">
                      {(Number(totalAmount) / 1e6).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                  </XStack>
                </XStack>
              )}
              <Separator height={1} borderColor="$borderNeutralSoft" />
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  {`${singleInstallment ? "Installment" : "First installment"} due`}
                </Text>
                <Text headline color="$uiNeutralPrimary">
                  {format(new Date(Number(maturity) * 1000), "MMM d, yyyy")}
                </Text>
              </XStack>
              {!singleInstallment && (
                <YStack>
                  <XStack gap="$s4" justifyContent="space-between">
                    <Text footnote color="$uiNeutralSecondary">
                      Following installments due
                    </Text>
                    <YStack alignItems="flex-end">
                      <Text headline color="$uiNeutralPrimary">
                        Every 28 days
                      </Text>
                    </YStack>
                  </XStack>
                  <XStack alignItems="center" justifyContent="flex-end">
                    <Text
                      cursor="pointer"
                      subHeadline
                      color="$interactiveBaseBrandDefault"
                      onPress={() => {
                        setPaymentScheduleShown(true);
                      }}
                    >
                      payment schedule
                    </Text>
                    <ChevronRight size={12} color="$interactiveBaseBrandDefault" strokeWidth={2} />
                  </XStack>
                </YStack>
              )}
              <Separator height={1} borderColor="$borderNeutralSoft" />
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  Receiving address
                </Text>
                <Text headline color="$uiNeutralPrimary">
                  {receiver === address ? "Your Exa account" : shortenHex(receiver ?? "", 6, 8)}
                </Text>
              </XStack>
            </YStack>
            <YStack>
              <Button
                primary
                onPress={() => {
                  propose(undefined, {}).catch(reportError);
                }}
                loading={pending}
                disabled={disabled}
              >
                <Button.Text>{`Confirm and ${receiver === address ? "receive" : "borrow"} ${symbol}`}</Button.Text>
                <Button.Icon>
                  <ArrowRight />
                </Button.Icon>
              </Button>
            </YStack>
          </YStack>
        </ScrollView>
        {singleInstallment ? null : (
          <PaymentScheduleSheet
            installmentsAmount={installmentsAmount}
            open={paymentScheduleShown}
            onClose={() => {
              setPaymentScheduleShown(false);
            }}
          />
        )}
      </SafeView>
    );
  }
  return (
    <GradientScrollView variant={error ? "error" : success ? (isLatestPlugin ? "info" : "success") : "neutral"}>
      <View flex={1}>
        <YStack gap="$s7" paddingBottom="$s9">
          <Pressable
            onPress={() => {
              if (error && navigation.canGoBack()) {
                navigation.goBack();
                return;
              }
              navigation.replace("(home)", { screen: "loans" });
            }}
          >
            <X size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <XStack justifyContent="center" alignItems="center">
            <Square
              size={80}
              borderRadius="$r4"
              backgroundColor={
                error
                  ? "$interactiveBaseErrorSoftDefault"
                  : success
                    ? isLatestPlugin
                      ? "$interactiveBaseInformationSoftDefault"
                      : "$interactiveBaseSuccessSoftDefault"
                    : "$backgroundStrong"
              }
            >
              {processing && <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />}
              {success && isLatestPlugin && <Check size={48} color="$uiInfoSecondary" strokeWidth={2} />}
              {success && !isLatestPlugin && <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />}
              {error && <X size={48} color="$uiErrorSecondary" strokeWidth={2} />}
            </Square>
          </XStack>
          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Text secondary body>
              {!error && !success && "Processing"}&nbsp;
              <Text emphasized primary body>
                Funding {error ? "failed" : success ? "request sent" : null}
              </Text>
            </Text>
            <XStack gap="$s2" alignItems="center" justifyContent="center">
              <AssetLogo
                height={32}
                source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                width={32}
              />
              <Text primary fontSize={34}>
                {(Number(totalAmount) / 1e6).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
            </XStack>
          </YStack>
        </YStack>
      </View>
      {!processing && (
        <YStack flex={2} justifyContent="flex-end" gap="$s5">
          {success && (
            <Button
              primary
              onPress={() => {
                navigation.replace("pending-proposals/index");
              }}
            >
              <Button.Text>Go to Requests</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
          )}
          <Text
            hitSlop={20}
            cursor="pointer"
            alignSelf="center"
            emphasized
            footnote
            color="$uiBrandSecondary"
            onPress={() => {
              if (error && navigation.canGoBack()) {
                navigation.goBack();
                return;
              }
              navigation.replace("(home)", { screen: "loans" });
            }}
          >
            {error ? "Go back" : "Close"}
          </Text>
        </YStack>
      )}
    </GradientScrollView>
  );
}
