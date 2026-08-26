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
import { lifiChainsOptions, receiverSchema } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function QR() {
  const { bottom, top } = useSafeAreaInsets();
  const router = useRouter();
  const { asset, fromChain, toChain, toToken, toSymbol, amount, fromAmount } = useLocalSearchParams();
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
          const [locator = "", query] = data.split("?");
          const [target = "", action] = locator.slice(locator.lastIndexOf(":") + 1).split("/");
          const [recipient = "", chainId] = target.replace(/^pay-/, "").split("@");
          const parameters = new URLSearchParams(query);
          const requested = parameters.get(action === undefined ? "value" : "uint256");
          const result = safeParse(
            receiverSchema(chainType),
            (chainId !== undefined && Number(chainId) !== destination) ||
              (requested !== null &&
                (typeof amount !== "string" || !/^\d+$/.test(amount) || baseUnits(requested) !== BigInt(amount)))
              ? ""
              : action === undefined
                ? recipient
                : action === "transfer" &&
                    typeof toToken === "string" &&
                    recipient.toLowerCase() === toToken.toLowerCase()
                  ? (parameters.get("address") ?? "")
                  : "",
          );
          if (!result.success) {
            setInvalid(true);
            return false;
          }
          router.dismissTo({
            pathname: "/send-funds/receiver",
            params: { receiver: result.output, asset, fromChain, toChain, toToken, toSymbol, amount, fromAmount },
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

function baseUnits(value: string) {
  const match = /^(\d+)(?:\.(\d+))?(?:e(\d+))?$/i.exec(value);
  if (!match) return;
  const [, integer = "", fraction = "", exponent = "0"] = match;
  const shift = Number(exponent);
  if (shift > 77 || fraction.length > shift) return;
  return BigInt(integer + fraction.padEnd(shift, "0"));
}
