import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, Pressable, Share } from "react-native";

import { setStringAsync } from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";

import { AlertTriangle, ArrowLeft, Files, Share as ShareIcon } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import SupportedAssetsSheet from "./SupportedAssetsSheet";
import assetLogos from "../../utils/assetLogos";
import { presentArticle } from "../../utils/intercom";
import networkLogos from "../../utils/networkLogos";
import reportError from "../../utils/reportError";
import { getRampQuote } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import CopyAddressSheet from "../shared/CopyAddressSheet";
import Image from "../shared/Image";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

const defaultAssets = Object.keys(assetLogos).filter((s) => s !== "USDC.e" && s !== "DAI");

export default function AddCrypto() {
  const router = useRouter();
  const fontScale = PixelRatio.getFontScale();
  const { address: accountAddress } = useAccount();
  const { t } = useTranslation();
  const { provider, currency, network } = useLocalSearchParams();
  const isBridge = provider === "bridge" && !!currency && !!network;

  const { data } = useQuery({
    queryKey: ["ramp", "quote", "bridge", currency, network],
    queryFn: () => getRampQuote({ provider: "bridge", currency, network } as Parameters<typeof getRampQuote>[0]),
    enabled: isBridge,
    staleTime: 10_000,
  });
  const deposit = data?.depositInfo.at(0);
  const depositAddress = deposit && "address" in deposit ? deposit.address : undefined;

  const address = isBridge ? depositAddress : accountAddress;
  const networkName = isBridge && typeof network === "string" ? network : chain.name;
  const assets = isBridge && typeof currency === "string" ? [currency] : defaultAssets;

  const [copyAddressShown, setCopyAddressShown] = useState(false);
  const [supportedAssetsShown, setSupportedAssetsShown] = useState(false);

  const copy = useCallback(() => {
    if (!address) return;
    setStringAsync(address).catch(reportError);
    setCopyAddressShown(true);
  }, [address]);

  const share = useCallback(async () => {
    if (!address) return;
    await Share.share({ message: address, title: t("Share {{chain}} address", { chain: networkName }) });
  }, [address, networkName, t]);

  return (
    <SafeView fullScreen>
      <View gap="$s5" fullScreen padded>
        <View gap="$s5">
          <XStack gap="$s3" justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <Pressable
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/(main)/(home)");
                  }
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <View flexDirection="row" alignItems="center" alignSelf="center">
              <Text emphasized subHeadline primary>
                {t("Add Funds")}
              </Text>
            </View>
          </XStack>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} flex={1}>
          <YStack gap="$s5">
            <YStack
              flex={1}
              borderBottomWidth={1}
              borderBottomColor="$borderNeutralSoft"
              paddingBottom="$s4_5"
              gap="$s5"
            >
              <Text emphasized subHeadline secondary>
                {isBridge
                  ? t("{{network}} deposit address", { network: networkName })
                  : t("Your {{chain}} address", { chain: networkName })}
              </Text>
              <Pressable hitSlop={15} onPress={copy} disabled={!address}>
                {address ? <Text mono>{address}</Text> : <Skeleton width="100%" height={24} />}
              </Pressable>
              <XStack alignItems="center" gap="$s4">
                <Button primary flex={1} onPress={copy} disabled={!address}>
                  <Button.Text>{t("Copy")}</Button.Text>
                  <Button.Icon>
                    <Files size={18 * fontScale} />
                  </Button.Icon>
                </Button>
                <Button
                  secondary
                  flex={1}
                  disabled={!address}
                  onPress={() => {
                    share().catch(reportError);
                  }}
                >
                  <Button.Text>{t("Share")}</Button.Text>
                  <Button.Icon>
                    <ShareIcon size={18 * fontScale} />
                  </Button.Icon>
                </Button>
              </XStack>
            </YStack>
            <CopyAddressSheet
              open={copyAddressShown}
              onClose={() => {
                setCopyAddressShown(false);
              }}
              address={isBridge ? depositAddress : undefined}
              network={isBridge && typeof network === "string" ? network : undefined}
              networkLogo={isBridge && typeof network === "string" ? networkLogos[network] : undefined}
              assets={isBridge ? assets : undefined}
            />
            {!isBridge && (
              <SupportedAssetsSheet
                open={supportedAssetsShown}
                onClose={() => {
                  setSupportedAssetsShown(false);
                }}
              />
            )}
            <XStack justifyContent="space-between" alignItems="center">
              <Text emphasized footnote color="$uiNeutralSecondary" textAlign="left">
                {t("Network")}
              </Text>
              <Text emphasized footnote color="$uiNeutralSecondary" textAlign="right">
                {isBridge ? t("Asset") : t("Supported Assets")}
              </Text>
            </XStack>
            <XStack gap="$s5" justifyContent="space-between" alignItems="center">
              <XStack alignItems="center" gap="$s3" flex={1}>
                {isBridge && typeof network === "string" && network in networkLogos ? (
                  <Image
                    source={{ uri: networkLogos[network] }}
                    width={32}
                    height={32}
                    borderRadius="$r_0"
                    overflow="hidden"
                  />
                ) : (
                  <ChainLogo size={32} />
                )}
                <Text emphasized primary headline>
                  {networkName}
                </Text>
              </XStack>
              <XStack
                borderWidth={1}
                borderColor="$borderNeutralSoft"
                borderRadius="$r_0"
                padding="$s3_5"
                alignSelf="flex-end"
                cursor="pointer"
                onPress={isBridge ? undefined : () => setSupportedAssetsShown(true)}
              >
                {assets.map((symbol, index) => (
                  <XStack key={symbol} marginRight={index < assets.length - 1 ? -12 : 0} zIndex={index}>
                    <AssetLogo symbol={symbol} width={32} height={32} />
                  </XStack>
                ))}
              </XStack>
            </XStack>
          </YStack>
        </ScrollView>
        <XStack
          gap="$s4"
          alignItems="flex-start"
          borderTopWidth={1}
          borderTopColor="$borderNeutralSoft"
          paddingTop="$s3"
        >
          <View>
            <AlertTriangle size={16} width={16} height={16} color="$uiWarningSecondary" />
          </View>
          <XStack flex={1}>
            <Text emphasized caption2 color="$uiNeutralPlaceholder" textAlign="justify">
              {isBridge
                ? t(
                    "Only send {{crypto}} on {{network}}. Sending other assets or using other networks may cause permanent loss.",
                    { crypto: currency, network: networkName },
                  )
                : t("Only send assets on {{chain}}. Sending funds from other networks may cause permanent loss.", {
                    chain: networkName,
                  })}
              <Text
                cursor="pointer"
                emphasized
                caption2
                color="$uiBrandSecondary"
                onPress={() => {
                  presentArticle("8950801").catch(reportError);
                }}
              >
                {" "}
                {t("Learn more about adding funds.")}
              </Text>
            </Text>
          </XStack>
        </XStack>
      </View>
    </SafeView>
  );
}
