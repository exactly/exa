import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { getStringAsync } from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft } from "@tamagui/lucide-icons-2/icons/ArrowLeft";
import { ArrowRight } from "@tamagui/lucide-icons-2/icons/ArrowRight";
import { Check } from "@tamagui/lucide-icons-2/icons/Check";
import { CircleHelp } from "@tamagui/lucide-icons-2/icons/CircleHelp";
import { ClipboardPaste } from "@tamagui/lucide-icons-2/icons/ClipboardPaste";
import { TriangleAlert } from "@tamagui/lucide-icons-2/icons/TriangleAlert";
import { toast } from "@tamagui/toast";
import { getTokens, ScrollView, Separator, XStack, YStack } from "tamagui";

import { useForm, useStore } from "@tanstack/react-form";
import { parse, safeParse } from "valibot";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { presentArticle } from "../../utils/intercom";
import Loan from "../../utils/Loan";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useInsets from "../../utils/useInsets";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Receiver() {
  const router = useRouter();
  const insets = useInsets();
  const { t } = useTranslation();
  const { address, isConnecting, isReconnecting } = useAccount();
  const { market, amount, installments, maturity, receiver: preset } = parse(Loan, useLocalSearchParams());
  const { market: asset, markets } = useAsset(market);
  const symbol = asset?.symbol.slice(3) === "WETH" ? "ETH" : asset?.symbol.slice(3);

  const [selected, setSelected] = useState<boolean>();
  const external = selected ?? (preset !== undefined && preset !== address);

  const form = useForm({
    defaultValues: { receiver: preset ?? "" },
    onSubmit: ({ value }) => {
      const parsed = safeParse(Address, external ? value.receiver : address);
      if (!parsed.success) {
        toast.error(t("Invalid address"), { duration: 1000 });
        return;
      }
      router.push({
        pathname: "/loan/review",
        params: {
          market,
          amount: String(amount),
          installments: String(installments),
          maturity: String(maturity),
          receiver: parsed.output,
        },
      });
    },
  });

  const receiver = useStore(form.store, (state) => state.values.receiver);
  const isValid = useStore(form.store, (state) => state.isValid);

  if (!market || !amount || !installments || !maturity || (markets && !asset)) return <Redirect href="/loan" />;
  if (preset !== undefined && !address && (isConnecting || isReconnecting)) {
    return (
      <SafeView fullScreen justifyContent="center" alignItems="center">
        <ExaSpinner backgroundColor="transparent" />
      </SafeView>
    );
  }
  return (
    <SafeView fullScreen paddingBottom="s0">
      <View padded flexDirection="row" gap="s3_5" paddingBottom="s4" justifyContent="space-between" alignItems="center">
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace({
              pathname: "/loan/maturity",
              params: {
                market,
                amount: String(amount),
                installments: String(installments),
                maturity: String(maturity),
              },
            });
          }}
        />
        <IconButton
          icon={CircleHelp}
          aria-label={t("Help")}
          onPress={() => {
            presentArticle("11541409").catch(reportError);
          }}
        />
      </View>
      <ScrollView
        backgroundColor="backgroundMild"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom }}
      >
        <YStack padding="s4" gap="s4" flex={1} justifyContent="space-between">
          <YStack gap="s6">
            <YStack gap="s4_5">
              <Text primary emphasized body>
                {t("Select where to receive the funding")}
              </Text>
              <YStack gap="s3">
                <XStack
                  backgroundColor={external ? "backgroundSoft" : "interactiveBaseBrandSoftDefault"}
                  minHeight={72}
                  borderRadius="r4"
                  alignItems="center"
                  padding="s4"
                  flex={1}
                  gap="s4"
                  cursor="pointer"
                  onPress={() => {
                    setSelected(false);
                  }}
                >
                  <XStack
                    backgroundColor={external ? "backgroundStrong" : "interactiveBaseBrandDefault"}
                    width="s4_5"
                    height="s4_5"
                    borderRadius="r4"
                    alignItems="center"
                    justifyContent="center"
                  >
                    {!external && <Check size={getTokens().iconSize.xs.val} color="interactiveOnBaseBrandDefault" />}
                  </XStack>
                  <YStack gap="s1" flex={1}>
                    <Text headline>{t("Your Exa account")}</Text>
                    <Text footnote color="uiNeutralSecondary">
                      {t("Deposit {{symbol}} into your Exa App wallet", { symbol })}
                    </Text>
                  </YStack>
                </XStack>
                <XStack
                  backgroundColor={external ? "interactiveBaseBrandSoftDefault" : "backgroundSoft"}
                  minHeight={72}
                  borderRadius="r4"
                  alignItems="center"
                  padding="s4"
                  flex={1}
                  gap="s4"
                  cursor="pointer"
                  onPress={() => {
                    setSelected(true);
                    form.setFieldValue("receiver", "");
                  }}
                >
                  <XStack
                    backgroundColor={external ? "interactiveBaseBrandDefault" : "backgroundStrong"}
                    width="s4_5"
                    height="s4_5"
                    borderRadius="r4"
                    alignItems="center"
                    justifyContent="center"
                  >
                    {external && <Check size={getTokens().iconSize.xs.val} color="interactiveOnBaseBrandDefault" />}
                  </XStack>
                  <YStack gap="s1" flex={1}>
                    <Text headline>{t("External address on {{chain}}", { chain: chain.name })}</Text>
                    <Text footnote color="uiNeutralSecondary">
                      {t("Deposit {{symbol}} directly to an external wallet", { symbol })}
                    </Text>
                  </YStack>
                </XStack>
                {external && (
                  <form.Field name="receiver" validators={{ onChange: Address }}>
                    {({ state: { value }, handleChange, setValue }) => {
                      return (
                        <XStack alignItems="center">
                          <Input
                            flex={1}
                            borderColor="uiNeutralTertiary hover:borderBrandStrong focus:borderBrandStrong focus-visible:borderBrandStrong"
                            borderRightColor="transparent hover:borderBrandStrong focus:borderBrandStrong focus-visible:borderBrandStrong"
                            borderTopRightRadius="r0"
                            borderBottomRightRadius="r0"
                            placeholder={t("Enter receiver address")}
                            value={value}
                            onChangeText={handleChange}
                          />
                          <Button
                            outlined
                            borderColor="uiNeutralTertiary"
                            borderRadius="r3"
                            borderTopLeftRadius="r0"
                            borderBottomLeftRadius="r0"
                            borderLeftWidth={0}
                            minHeight={44}
                            height={44}
                            onPress={() => {
                              getStringAsync()
                                .then((text) => {
                                  setValue(text);
                                })
                                .catch(reportError);
                            }}
                          >
                            <Button.Icon>
                              <ClipboardPaste size={getTokens().iconSize.lg.val} />
                            </Button.Icon>
                          </Button>
                        </XStack>
                      );
                    }}
                  </form.Field>
                )}
              </YStack>
            </YStack>
          </YStack>
          <YStack gap="s4_5">
            {external && (
              <YStack gap="s4_5">
                <Separator borderColor="borderNeutralSoft" />
                <XStack gap="s3" alignItems="center">
                  <TriangleAlert size={16} color="uiWarningSecondary" />
                  <Text caption2 color="uiNeutralPlaceholder" flex={1}>
                    <Trans
                      i18nKey="Send funds only to {{chain}} addresses. Sending assets to any other network will cause irreversible loss of funds. Arrival time ≈ 5 min.<learn> Learn more about sending funds.</learn>"
                      values={{ chain: chain.name }}
                      components={{
                        learn: (
                          <Text
                            caption2
                            emphasized
                            color="uiBrandSecondary"
                            cursor="pointer"
                            onPress={() => {
                              presentArticle("9056481").catch(reportError);
                            }}
                          />
                        ),
                      }}
                    />
                  </Text>
                </XStack>
              </YStack>
            )}
            <Button
              primary
              onPress={() => {
                form.handleSubmit().catch(reportError);
              }}
              disabled={external ? !receiver || !isValid : !address}
            >
              <Button.Text>{t("Review loan terms")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
