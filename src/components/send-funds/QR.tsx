import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft } from "@tamagui/lucide-icons";
import { Spinner, XStack, YStack } from "tamagui";

import { ChainType } from "@lifi/sdk";
import { useQuery } from "@tanstack/react-query";
import { safeParse } from "valibot";

import chain from "@exactly/common/generated/chain";

import Scanner from "./Scanner";
import { lifiChainsOptions } from "../../utils/lifi";
import receiverSchema from "../../utils/receiverSchema";
import reportError from "../../utils/reportError";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function QR() {
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const { asset, fromChain, toChain, toToken, amount, fromAmount } = useLocalSearchParams();
  const destination = typeof toChain === "string" ? Number(toChain) : chain.id;
  const { data: chains, isFetching, refetch } = useQuery(lifiChainsOptions);
  const destinationChain = chains?.find((item) => item.id === destination);
  const chainType = destinationChain?.chainType ?? (destination === chain.id ? ChainType.EVM : undefined);

  const [invalid, setInvalid] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!invalid) return;
    const timer = setTimeout(() => setInvalid(false), 2000);
    return () => clearTimeout(timer);
  }, [invalid]);

  if (chainType === undefined) {
    return (
      <View fullScreen justifyContent="center" alignItems="center" backgroundColor="$backgroundSoft">
        <Back />
        {isFetching ? (
          <Spinner size="large" color="$uiBrandSecondary" />
        ) : (
          <View padded>
            <YStack gap="$s4">
              <Text secondary subHeadline textAlign="center">
                {t("Something went wrong. Please try again.")}
              </Text>
              <Button
                secondary
                alignSelf="center"
                onPress={() => {
                  refetch().catch(reportError);
                }}
              >
                <Button.Text>{t("Retry")}</Button.Text>
              </Button>
            </YStack>
          </View>
        )}
      </View>
    );
  }
  return (
    <View fullScreen position="relative" backgroundColor="$backgroundSoft">
      <Scanner
        onClose={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/send-funds");
        }}
        onScan={(data) => {
          const result = safeParse(receiverSchema(chainType), scanned(data));
          if (!result.success) {
            setInvalid(true);
            return false;
          }
          router.dismissTo({
            pathname: "/send-funds/receiver",
            params: { receiver: result.output, asset, fromChain, toChain, toToken, amount, fromAmount },
          });
          return true;
        }}
      />
      {invalid && (
        <View
          position="absolute"
          bottom={bottom + 72}
          alignSelf="center"
          backgroundColor="$interactiveBaseErrorDefault"
          borderRadius="$r3"
          paddingHorizontal="$s4"
          paddingVertical="$s3"
        >
          <Text emphasized footnote color="$interactiveOnBaseErrorDefault">
            {t("Invalid {{chain}} address", { chain: (destinationChain ?? chain).name })}
          </Text>
        </View>
      )}
    </View>
  );
}

function Back() {
  const { top } = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <XStack
      position="absolute"
      borderRadius="$r_0"
      backgroundColor="transparent"
      alignItems="center"
      top={top}
      left="$s4"
      padding="$s3"
      gap="$s2"
      cursor="pointer"
      role="button"
      aria-label={t("Back")}
      onPress={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/send-funds");
        }
      }}
    >
      <ArrowLeft size={24} color="$uiNeutralPrimary" />
      <Text headline>{t("Back")}</Text>
    </XStack>
  );
}

function scanned(data: string) {
  const [locator = "", query] = data.split("?");
  const [target = "", action] = locator.slice(locator.lastIndexOf(":") + 1).split("/");
  if (action === undefined) return target.replace(/^pay-/, "").split("@")[0] ?? "";
  return action === "transfer" ? (new URLSearchParams(query).get("address") ?? "") : "";
}
