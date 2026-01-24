import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, X } from "@tamagui/lucide-icons";
import { ScrollView, Separator, Square, XStack, YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { encodeAbiParameters, encodeFunctionData, maxUint256, zeroAddress, type Address, type Hex } from "viem";
import { useBytecode, useChainId, useSendCalls } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain from "@exactly/common/generated/chain";
import {
  exaPluginAbi,
  exaPluginAddress,
  marketUsdcAddress,
  upgradeableModularAccountAbi,
  useReadPreviewerPreviewBorrowAtMaturity,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";

import assetLogos from "../../utils/assetLogos";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import exa from "../../utils/wagmi/exa";
import AssetLogo from "../shared/AssetLogo";
import GradientScrollView from "../shared/GradientScrollView";
import PaymentScheduleSheet from "../shared/PaymentScheduleSheet";
import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Loan } from "../../utils/queryClient";

export default function Review() {
  const router = useRouter();
  const chainId = useChainId();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address } = useAccount();
  const marketUSDC = marketUsdcAddress[chainId as keyof typeof marketUsdcAddress];
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
    args: [marketUSDC, maturity ?? 0n, amount ?? 0n],
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

  const { mutateAsync: mutateSendCalls } = useSendCalls();
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
      const calls: { data: Hex; to: Address }[] = [];
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
        calls.push({ to: address, data });
      }
      const { id } = await mutateSendCalls({
        calls,
        capabilities: {
          paymasterService: {
            context: { policyId: alchemyGasPolicyId },
            url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
          },
        },
      });
      const { status } = await waitForCallsStatus(exa, { id });
      if (status === "failure") throw new Error("failed to submit borrow proposal");
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
  const disabled =
    pending ||
    !address ||
    !receiver ||
    !market ||
    !bytecode ||
    (!singleInstallment && !split) ||
    (singleInstallment && !borrow);
  const statusMessage = error
    ? t("Funding failed")
    : success
      ? t("Funding request sent")
      : t("Funding request processing");

  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress[chainId as keyof typeof exaPluginAddress];

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
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace("/loan/receiver");
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
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
            <YStack gap="$s4">
              <Text primary emphasized body>
                {t("Review terms")}
              </Text>
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  {receiver === address ? t("You receive") : t("You send")}
                </Text>
                <XStack alignItems="center" gap="$s2">
                  <AssetLogo
                    height={16}
                    source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                    width={16}
                  />
                  <Text title3 color="$uiNeutralPrimary">
                    {(Number(amount ?? 0n) / 10 ** (assetMarket?.decimals ?? 6)).toLocaleString(language, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                </XStack>
              </XStack>
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  {t("Fixed {{rate}} APR", {
                    rate: rate.toLocaleString(language, {
                      style: "percent",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }),
                  })}
                </Text>
                <XStack alignItems="center" gap="$s2">
                  <AssetLogo
                    height={16}
                    source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                    width={16}
                  />
                  <Text title3 color="$uiNeutralPrimary">
                    {(Number(feeAmount) / 10 ** (assetMarket?.decimals ?? 6)).toLocaleString(language, {
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
                        {(
                          Number(singleInstallment ? totalAmount : installmentsAmount) /
                          10 ** (assetMarket?.decimals ?? 6)
                        ).toLocaleString(language, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </XStack>
                  </XStack>
                </XStack>
                {singleInstallment ? null : (
                  <XStack gap="$s4" alignItems="center" justifyContent="flex-end">
                    <Text footnote color="$uiNeutralSecondary">
                      {t("each")}
                    </Text>
                  </XStack>
                )}
              </YStack>
              {singleInstallment ? null : (
                <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                  <Text footnote color="$uiNeutralSecondary">
                    {t("Total")}
                  </Text>
                  <XStack alignItems="center" gap="$s2">
                    <AssetLogo
                      height={16}
                      source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                      width={16}
                    />
                    <Text title3 color="$uiNeutralPrimary">
                      {(Number(totalAmount) / 10 ** (assetMarket?.decimals ?? 6)).toLocaleString(language, {
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
                  {singleInstallment ? t("Installment due") : t("First installment due")}
                </Text>
                <Text headline color="$uiNeutralPrimary">
                  {new Date(Number(maturity) * 1000).toLocaleDateString(language, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </Text>
              </XStack>
              {!singleInstallment && (
                <YStack>
                  <XStack gap="$s4" justifyContent="space-between">
                    <Text footnote color="$uiNeutralSecondary">
                      {t("Following installments due")}
                    </Text>
                    <YStack alignItems="flex-end">
                      <Text headline color="$uiNeutralPrimary">
                        {t("Every 28 days")}
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
                      {t("payment schedule")}
                    </Text>
                    <ChevronRight size={12} color="$interactiveBaseBrandDefault" strokeWidth={2} />
                  </XStack>
                </YStack>
              )}
              <Separator height={1} borderColor="$borderNeutralSoft" />
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  {t("Receiving address")}
                </Text>
                <Text headline color="$uiNeutralPrimary">
                  {receiver === address ? t("Your Exa account") : shortenHex(receiver ?? "", 6, 8)}
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
                <Button.Text>
                  {receiver === address
                    ? t("Confirm and receive {{symbol}}", { symbol })
                    : t("Confirm and borrow {{symbol}}", { symbol })}
                </Button.Text>
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
              if (error && router.canGoBack()) {
                router.back();
                return;
              }
              router.replace("/loan");
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
            <Text emphasized primary body>
              {statusMessage}
            </Text>
            <XStack gap="$s2" alignItems="center" justifyContent="center">
              <AssetLogo
                height={32}
                source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                width={32}
              />
              <Text primary fontSize={34}>
                {(Number(totalAmount) / 10 ** (assetMarket?.decimals ?? 6)).toLocaleString(language, {
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
                router.replace("/pending-proposals");
              }}
            >
              <Button.Text>{t("Go to Requests")}</Button.Text>
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
              if (error && router.canGoBack()) {
                router.back();
                return;
              }
              router.replace("/loan");
            }}
          >
            {error ? t("Go back") : t("Close")}
          </Text>
        </YStack>
      )}
    </GradientScrollView>
  );
}
