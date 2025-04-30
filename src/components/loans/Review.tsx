import type { BatchUserOperationCallData } from "@alchemy/aa-core";
import ProposalType from "@exactly/common/ProposalType";
import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";
import { ArrowLeft, ArrowRight, CircleHelp } from "@tamagui/lucide-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { router } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";
import { parse } from "valibot";
import { encodeAbiParameters, encodeFunctionData, maxUint256, zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import {
  exaPluginAbi,
  upgradeableModularAccountAbi,
  useReadPreviewerPreviewBorrowAtMaturity,
} from "../../generated/contracts";
import { accountClient } from "../../utils/alchemyConnector";
import assetLogos from "../../utils/assetLogos";
import type { Loan } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import useIntercom from "../../utils/useIntercom";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import Failure from "../shared/Failure";
import PaymentScheduleSheet from "../shared/PaymentScheduleSheet";
import Pending from "../shared/Pending";
import SafeView from "../shared/SafeView";
import Success from "../shared/Success";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Review() {
  const { canGoBack } = router;
  const { t } = useTranslation();
  const { address } = useAccount();
  const { presentArticle } = useIntercom();
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
  const usdPrice = assetMarket?.usdPrice ?? 0n;
  const decimals = assetMarket?.decimals ?? 6;
  const singleInstallment = count === 1;

  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });

  const { data: borrow, isPending: isBorrowPending } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [marketUSDCAddress, maturity, amount],
    query: { enabled: !!address && !!bytecode && !!maturity && !!amount && singleInstallment },
  });

  const { data: split, isFetching: isInstallmentsPending } = useInstallments({
    totalAmount: amount,
    installments: count,
    marketAddress: market,
    timestamp: Number(maturity),
  });

  const totalAmountUSD = borrow
    ? (borrow.assets * usdPrice) / 10n ** BigInt(decimals)
    : split
      ? (split.installments.reduce((accumulator, current) => accumulator + current, 0n) * usdPrice) /
        10n ** BigInt(decimals)
      : 0n;
  const installmentsAmountUSD = split ? ((split.installments[0] ?? 0n) * usdPrice) / 10n ** BigInt(decimals) : 0n;
  const feeUSD = borrow
    ? ((borrow.assets - amount) * usdPrice) / 10n ** BigInt(decimals)
    : split
      ? ((split.installments.reduce((accumulator, current) => accumulator + current, 0n) - amount) * usdPrice) /
        10n ** BigInt(decimals)
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
      if (!split) throw new Error("no installment data");
      if (!accountClient) throw new Error("no account client");
      const uo: BatchUserOperationCallData = [];
      for (let index = 0; index < count; index++) {
        const borrowAmount = split.amounts[index];
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
    ? Number(((borrow.assets - amount) * WAD * 31_536_000n) / (amount * (borrow.maturity - BigInt(timestamp)))) / 1e18
    : split
      ? Number(split.effectiveRate) / 1e18
      : 0;

  const pending = isAssetPending || (singleInstallment ? isBorrowPending : isInstallmentsPending);
  const processing = isProposingBorrowInstallments;
  const success = isProposingBorrowInstallmentsSuccess;
  const error = !!proposeBorrowInstallmentsError;
  const disabled = pending;

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
              if (canGoBack()) {
                router.back();
                return;
              }
              router.replace("/loan/receiver");
            }}
          >
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <Text primary emphasized subHeadline>
            Review loan terms
          </Text>
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
                Review your loan details
              </Text>
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  {`You ${receiver === address ? "receive" : "send"}`}
                </Text>
                <XStack alignItems="center" gap="$s2">
                  <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
                  <Text title3 color="$uiNeutralPrimary">
                    {Number(Number((amount * usdPrice) / 10n ** BigInt(decimals)) / 1e18).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
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
                  <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
                  <Text title3 color="$uiNeutralPrimary">
                    {(Number(feeUSD) / 1e18).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                </XStack>
              </XStack>
              <Separator height={1} borderColor="$borderNeutralSoft" />
              <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                <Text footnote color="$uiNeutralSecondary">
                  {t("You repay {{count}} installments of", { count })}
                </Text>
                <XStack alignItems="center" gap="$s2">
                  <YStack alignItems="flex-end">
                    <XStack alignItems="center" gap="$s2">
                      <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
                      <Text title3 color="$uiNeutralPrimary">
                        {(Number(singleInstallment ? totalAmountUSD : installmentsAmountUSD) / 1e18).toLocaleString(
                          undefined,
                          { style: "currency", currency: "USD" },
                        )}
                      </Text>
                    </XStack>
                    {singleInstallment ? null : (
                      <Text footnote color="$uiNeutralSecondary">
                        each
                      </Text>
                    )}
                  </YStack>
                </XStack>
              </XStack>
              {singleInstallment ? null : (
                <XStack gap="$s4" alignItems="center" justifyContent="space-between">
                  <Text footnote color="$uiNeutralSecondary">
                    Total
                  </Text>
                  <XStack alignItems="center" gap="$s2">
                    <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
                    <Text title3 color="$uiNeutralPrimary">
                      {(Number(totalAmountUSD) / 1e18).toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
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
                <XStack gap="$s4" justifyContent="space-between">
                  <Text footnote color="$uiNeutralSecondary">
                    Following installments due
                  </Text>
                  <YStack alignItems="flex-end">
                    <Text headline color="$uiNeutralPrimary">
                      Every 28 days
                    </Text>
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
                  </YStack>
                </XStack>
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
                main
                spaced
                outlined
                onPress={() => {
                  propose(undefined, {}).catch(reportError);
                }}
                disabled={disabled}
                backgroundColor={disabled ? "$interactiveDisabled" : "$interactiveBaseBrandSoftDefault"}
                color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
                iconAfter={
                  pending ? (
                    <Spinner color="$interactiveOnDisabled" />
                  ) : (
                    <ArrowRight
                      color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
                      strokeWidth={2.5}
                    />
                  )
                }
                flex={0}
              >
                {`Confirm and ${receiver === address ? "receive" : "borrow"} ${symbol}`}
              </Button>
            </YStack>
          </YStack>
        </ScrollView>
        <PaymentScheduleSheet
          usdAmount={installmentsAmountUSD}
          open={paymentScheduleShown}
          onClose={() => {
            setPaymentScheduleShown(false);
          }}
        />
      </SafeView>
    );
  }
  if (processing)
    return (
      <Pending
        maturity={maturity}
        amount={Number((amount * usdPrice) / 10n ** BigInt(decimals)) / 1e18}
        usdAmount={Number(totalAmountUSD) / 1e18}
        currency={symbol}
        selectedAsset={parse(Address, market)}
      />
    );
  if (success)
    return (
      <Success
        maturity={maturity}
        amount={Number((amount * usdPrice) / 10n ** BigInt(decimals)) / 1e18}
        usdAmount={Number(totalAmountUSD) / 1e18}
        currency={symbol}
        selectedAsset={parse(Address, market)}
        onClose={() => {
          router.replace("/pending-proposals");
        }}
      />
    );
  if (error)
    return (
      <Failure
        maturity={maturity}
        amount={Number((amount * usdPrice) / 10n ** BigInt(decimals)) / 1e18}
        usdAmount={Number(totalAmountUSD) / 1e18}
        currency={symbol}
        selectedAsset={parse(Address, market)}
        onClose={() => {
          router.replace("/loans");
        }}
      />
    );
}
