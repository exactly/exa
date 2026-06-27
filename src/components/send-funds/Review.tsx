import React from "react";
import { Trans, useTranslation } from "react-i18next";

import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check, CircleHelp } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { safeParse } from "valibot";
import { encodeFunctionData, formatUnits, parseUnits } from "viem";
import { useSendCalls } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain, { marketUSDCAddress } from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";
import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";

import { bridgeFee, bridgeFiatCurrencies, getSymbol } from "../../utils/currencies";
import { presentArticle } from "../../utils/intercom";
import parseAmount from "../../utils/parseAmount";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getRampQuote, listExternalAccounts } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useSimulateProposal from "../../utils/useSimulateProposal";
import exa from "../../utils/wagmi/exa";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

function isFiatCurrency(value: string): value is (typeof bridgeFiatCurrencies)[number] {
  return (bridgeFiatCurrencies as readonly string[]).includes(value);
}

const MINIMUM_USDC = 10;

export default function Review() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const toast = useToastController();
  const { currency, provider, contactId, amount: amountParameter } = useLocalSearchParams();
  const currencyString = typeof currency === "string" ? currency : "";
  const contactString = typeof contactId === "string" ? contactId : "";
  const fiatCurrency = isFiatCurrency(currencyString) ? currencyString : undefined;
  const providerString = typeof provider === "string" ? provider : "";
  const amount = parseAmount(typeof amountParameter === "string" ? amountParameter : "0");
  const ready = !!fiatCurrency && !!contactString && amount > 0n && providerString === "bridge";
  const symbol = getSymbol(currencyString);

  const { data: recipients } = useQuery({
    queryKey: ["ramp", "external-accounts"],
    queryFn: listExternalAccounts,
  });
  const recipient = recipients?.find((account) => account.id === contactString);

  const { data: quote } = useQuery({
    queryKey: ["ramp", "quote", "offramp", { currency: fiatCurrency, externalAccountId: contactString }],
    queryFn: () => {
      if (!fiatCurrency || !contactString) throw new Error("invalid params");
      return getRampQuote({
        provider: "bridge",
        direction: "offramp",
        currency: fiatCurrency,
        externalAccountId: contactString,
      });
    },
    enabled: ready,
  });
  const buyRate = quote?.quote?.buyRate;
  const rate = buyRate ? parseAmount(buyRate, 18) : undefined;
  const usdcAmount = rate ? (amount * WAD + rate - 1n) / rate : undefined;
  const depositInfo = quote?.depositInfo[0];
  const depositResult = depositInfo && "address" in depositInfo ? safeParse(Address, depositInfo.address) : undefined;
  const depositAddress = depositResult?.success ? depositResult.output : undefined;

  const { address: userAddress } = useAccount({ config: exa });
  const { request: proposeSimulation } = useSimulateProposal({
    account: userAddress,
    amount: usdcAmount,
    market: marketUSDCAddress,
    proposalType: ProposalType.Withdraw,
    receiver: depositAddress,
    enabled: !!userAddress && !!depositAddress && !!usdcAmount,
  });

  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const transfer = useMutation({
    mutationFn: async () => {
      if (!proposeSimulation) throw new Error("propose not ready");
      const { address: to, abi, functionName, args } = proposeSimulation;
      const { id } = await mutateSendCalls({
        chainId: chain.id,
        calls: [{ to, data: encodeFunctionData({ abi, functionName, args }) }],
        capabilities: {
          paymasterService: {
            url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
            context: { policyId: alchemyGasPolicyId },
          },
        },
      });
      const result = await waitForCallsStatus(exa, { id });
      if (result.status === "failure") throw new Error("transaction failed");
      return result.receipts?.[0]?.transactionHash;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity"] }).catch(reportError);
    },
    onError: (error) => {
      reportError(error);
      toast.show(t("Transfer failed"), {
        duration: 3000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  if (!ready) return <Redirect href="/send-funds" />;

  const recipientName = recipient?.ownerName ?? t("beneficiary");
  const recipientValid = !!recipient && recipient.currency === currencyString && recipient.addressValid !== false;
  const meetsMinimum = usdcAmount !== undefined && usdcAmount >= parseUnits(String(MINIMUM_USDC), 6);

  if (transfer.isPending || transfer.isSuccess) {
    const sent = transfer.isSuccess;
    return (
      <View fullScreen backgroundColor="$backgroundSoft">
        {sent && (
          <StyledGradient
            locations={[0.5, 1]}
            position="absolute"
            top={0}
            left={0}
            right={0}
            height={220}
            opacity={0.2}
            colors={[theme.uiSuccessSecondary.val, theme.backgroundSoft.val]}
          />
        )}
        <SafeView fullScreen backgroundColor="transparent">
          <View gap="$s5" fullScreen padded justifyContent="space-between">
            <YStack flex={1} justifyContent="center" alignItems="center" gap="$s5">
              <Square
                borderRadius="$r4"
                size={80}
                backgroundColor={sent ? "$interactiveBaseSuccessSoftDefault" : "$backgroundStrong"}
              >
                {sent ? (
                  <Check size={32} color="$uiSuccessSecondary" strokeWidth={2.5} />
                ) : (
                  <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />
                )}
              </Square>

              <YStack gap="$s3" alignItems="center">
                <Text headline primary>
                  <Trans
                    i18nKey={sent ? "Sent to <em>{{recipient}}</em>" : "Sending to <em>{{recipient}}</em>"}
                    values={{ recipient: recipientName }}
                    components={{ em: <Text headline primary emphasized /> }}
                  />
                </Text>
                <Text title emphasized primary>
                  {`${symbol}${Number(formatUnits(amount, 6)).toFixed(2)}`}
                </Text>
                <XStack gap="$s2" alignItems="center">
                  <AssetLogo symbol="USDC" width={16} height={16} />
                  <Text footnote color="$uiNeutralSecondary">
                    {usdcAmount === undefined ? "—" : Number(formatUnits(usdcAmount, 6)).toFixed(2)}
                  </Text>
                </XStack>
              </YStack>
            </YStack>

            {sent ? (
              <YStack gap="$s3" alignItems="center">
                <Button
                  onPress={() => {
                    router.replace("/activity");
                  }}
                  primary
                >
                  <Button.Text>{t("View pending requests")}</Button.Text>
                  <Button.Icon>
                    <ArrowRight />
                  </Button.Icon>
                </Button>
                <Text
                  cursor="pointer"
                  emphasized
                  footnote
                  color="$uiBrandSecondary"
                  onPress={() => {
                    router.replace("/(main)/(home)");
                  }}
                >
                  {t("Close")}
                </Text>
              </YStack>
            ) : (
              <XStack
                width="100%"
                backgroundColor="$backgroundStrong"
                paddingHorizontal="$s4"
                paddingVertical="$s4"
                borderRadius="$r3"
                justifyContent="space-between"
                alignItems="center"
              >
                <Text footnote color="$uiNeutralSecondary">
                  {t("Processing transfer...")}
                </Text>
                <ExaSpinner backgroundColor="transparent" color="$uiNeutralSecondary" containerSize={24} size={16} />
              </XStack>
            )}
          </View>
        </SafeView>
      </View>
    );
  }

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s5" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds");
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Review and confirm")}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>

        <ScrollView flex={1}>
          <YStack flex={1}>
            <ReviewRow
              label={t("Send")}
              value={
                <Text emphasized primary>
                  {`${symbol}${Number(formatUnits(amount, 6)).toFixed(2)}`}
                </Text>
              }
            />
            <ReviewRow
              label={t("To")}
              value={
                <YStack alignItems="flex-end" gap="$s1">
                  <Text emphasized primary>
                    {recipient?.ownerName ?? "—"}
                  </Text>
                  <Text emphasized primary>
                    {recipient?.bankName ?? t("Bank account")}
                  </Text>
                </YStack>
              }
            />
            <ReviewRow
              label={t("Transfer fee")}
              value={
                <XStack gap="$s2" alignItems="center">
                  <Text emphasized strikeThrough color="$uiNeutralSecondary">
                    {bridgeFee(currencyString)}
                  </Text>
                  <Text emphasized color="$uiSuccessSecondary">
                    {t("Free")}
                  </Text>
                </XStack>
              }
            />
            <ReviewRow
              label={t("Total")}
              value={
                <XStack gap="$s2" alignItems="center">
                  <AssetLogo symbol="USDC" width={20} height={20} />
                  <Text emphasized primary>
                    {usdcAmount === undefined ? "—" : Number(formatUnits(usdcAmount, 6)).toFixed(2)}
                  </Text>
                </XStack>
              }
            />
          </YStack>
        </ScrollView>

        <Button
          onPress={() => {
            transfer.mutate();
          }}
          primary
          disabled={!proposeSimulation || !recipientValid || !meetsMinimum}
        >
          <Button.Text>{t("Confirm and send")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </View>
    </SafeView>
  );
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack
      paddingVertical="$s4"
      borderBottomWidth={1}
      borderBottomColor="$borderNeutralSoft"
      justifyContent="space-between"
      alignItems="flex-start"
    >
      <Text color="$uiNeutralPlaceholder">{label}</Text>
      {value}
    </XStack>
  );
}

const StyledGradient = styled(LinearGradient, {});
