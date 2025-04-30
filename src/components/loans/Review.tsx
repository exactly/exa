import type { BatchUserOperationCallData } from "@alchemy/aa-core";
import ProposalType from "@exactly/common/ProposalType";
import { previewerAddress } from "@exactly/common/generated/chain";
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
import { encodeAbiParameters, encodeFunctionData, zeroAddress } from "viem";
import { useAccount, useWriteContract } from "wagmi";

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
import useSimulateProposal from "../../utils/useSimulateProposal";
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
  const isBorrow = count === 1;

  const {
    data: split,
    firstMaturity,
    timestamp,
    isFetching: isInstallmentsPending,
  } = useInstallments({
    totalAmount: amount,
    installments: count,
    marketAddress: market,
  });

  const { data: borrow, isPending: isBorrowPending } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [assetMarket?.market ?? zeroAddress, BigInt(firstMaturity), amount],
    query: { enabled: isBorrow && amount > 0n && !!assetMarket && !!address && !!firstMaturity },
  });

  const totalAmountUSD =
    !isBorrow && split
      ? (split.installments.reduce((accumulator, current) => accumulator + current, 0n) * usdPrice) /
        10n ** BigInt(decimals)
      : ((borrow?.assets ?? 0n) * usdPrice) / 10n ** BigInt(decimals);

  const installmentsAmountUSD =
    !isBorrow && split
      ? ((split.installments[0] ?? 0n) * usdPrice) / 10n ** BigInt(decimals)
      : ((borrow?.assets ?? 0n) * usdPrice) / 10n ** BigInt(decimals);

  const feeUSD =
    isBorrow && borrow
      ? ((borrow.assets - amount) * usdPrice) / 10n ** BigInt(decimals)
      : !isBorrow && split
        ? ((split.installments.reduce((accumulator, current) => accumulator + current, 0n) - amount) * usdPrice) /
          10n ** BigInt(decimals)
        : 0n;

  const slippage = (WAD * 105n) / 100n;
  const maxAssets = borrow ? (borrow.assets * slippage) / WAD : 0n;

  const {
    executeProposal: { error: simulateExecuteProposalError, isPending: isSimulateExecuteProposalPending },
    propose: {
      data: simulateProposeBorrowAtMaturity,
      error: simulateProposeBorrowAtMaturityError,
      isPending: isSimulateProposeBorrowAtMaturityPending,
    },
  } = useSimulateProposal({
    proposalType: ProposalType.BorrowAtMaturity,
    amount,
    market,
    enabled: isBorrow && !!amount && !!market && !!maturity && !!receiver,
    maturity,
    maxAssets,
    receiver: loan?.receiver,
    account: address,
  });

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
        const borrowMaturity = Number(loan?.maturity) + index * MATURITY_INTERVAL;
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
                { name: "assets", internalType: "uint256", type: "uint256" },
                { name: "maxAssets", internalType: "uint256", type: "uint256" },
                { name: "receiver", internalType: "address", type: "address" },
                { name: "borrower", internalType: "address", type: "address" },
              ],
              [BigInt(borrowMaturity), borrowAmount, (borrowAmount * slippage) / WAD, receiver, address],
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

  const {
    writeContract,
    isPending: isProposingBorrowAtMaturity,
    isSuccess: isProposingBorrowAtMaturitySuccess,
    isError: proposeBorrowAtMaturityError,
  } = useWriteContract();

  const pending =
    isAssetPending ||
    (isBorrow
      ? isBorrowPending || isSimulateExecuteProposalPending || isSimulateProposeBorrowAtMaturityPending
      : isInstallmentsPending);

  const processing = isProposingBorrowAtMaturity || isProposingBorrowInstallments;
  const success = isProposingBorrowAtMaturitySuccess || isProposingBorrowInstallmentsSuccess;
  const error = !!proposeBorrowAtMaturityError || !!proposeBorrowInstallmentsError;
  const disabled = pending || !!simulateProposeBorrowAtMaturityError || !!simulateExecuteProposalError;

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
              router.replace("/");
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
                  {`Fixed ${
                    (!isBorrow && split
                      ? Number(split.effectiveRate) / 1e18
                      : borrow
                        ? Number(
                            ((borrow.assets - amount) * WAD * 31_536_000n) /
                              (amount * (borrow.maturity - BigInt(timestamp))),
                          ) / 1e18
                        : null
                    )?.toLocaleString(undefined, {
                      style: "percent",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }) ?? "N/A"
                  } APR`}
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
                        {(Number(installmentsAmountUSD) / 1e18).toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                        })}
                      </Text>
                    </XStack>
                    {isBorrow ? null : (
                      <Text footnote color="$uiNeutralSecondary">
                        each
                      </Text>
                    )}
                  </YStack>
                </XStack>
              </XStack>
              {isBorrow ? null : (
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
                  {`${isBorrow ? "Installment" : "First installment"} due`}
                </Text>
                <Text headline color="$uiNeutralPrimary">
                  {format(new Date(Number(maturity) * 1000), "MMM d, yyyy")}
                </Text>
              </XStack>
              {!isBorrow && (
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
            <YStack paddingHorizontal="$s4">
              <Button
                main
                spaced
                outlined
                onPress={() => {
                  if (isBorrow) {
                    if (!simulateProposeBorrowAtMaturity) return;
                    writeContract(simulateProposeBorrowAtMaturity.request);
                  } else {
                    propose(undefined, {}).catch(reportError);
                  }
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
          router.replace("/loans");
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
