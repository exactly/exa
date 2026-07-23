import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, Pressable, Share } from "react-native";
import QRCode from "react-native-qrcode-styled";

import { setStringAsync } from "expo-clipboard";
import { selectionAsync } from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";

import { AlertTriangle, ArrowLeft, Copy, QrCode, RefreshCw, Share as ShareIcon } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import BridgeDisclaimer from "./BridgeDisclaimer";
import SupportedAssetsSheet from "./SupportedAssetsSheet";
import { presentArticle } from "../../utils/intercom";
import networkLogos from "../../utils/networkLogos";
import reportError from "../../utils/reportError";
import { getRampQuote } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import CopyAddressSheet from "../shared/CopyAddressSheet";
import IconButton from "../shared/IconButton";
import Image from "../shared/Image";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AddCrypto() {
  const router = useRouter();
  const fontScale = PixelRatio.getFontScale();
  const { address: accountAddress } = useAccount();
  const { supportedAssets, isPending } = useMarkets();
  const { t } = useTranslation();
  const {
    provider,
    currency: currencyParameter,
    network: networkParameter,
    asset: assetParameter,
  } = useLocalSearchParams();
  const currency = typeof currencyParameter === "string" ? currencyParameter : "";
  const network = typeof networkParameter === "string" ? networkParameter : "";
  const asset = typeof assetParameter === "string" ? assetParameter : "";
  const isBridge = provider === "bridge" && !!currency && !!network;

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["ramp", "quote", "bridge", currency, network],
    queryFn: () =>
      getRampQuote({ provider: "bridge", currency, network, direction: "onramp" } as Parameters<
        typeof getRampQuote
      >[0]),
    enabled: isBridge,
    retry: false,
    staleTime: 10_000,
  });
  const deposit = data?.depositInfo.at(0);
  const depositAddress = deposit && "address" in deposit ? deposit.address : undefined;
  const memo = deposit && "memo" in deposit ? deposit.memo : undefined;

  const address = isBridge ? depositAddress : accountAddress;
  const networkName = isBridge && typeof network === "string" ? network : chain.name;
  const assets = isBridge ? [currency] : asset ? [asset] : supportedAssets;

  const toast = useToastController();
  const [copyAddressShown, setCopyAddressShown] = useState(false);
  const [qrShown, setQRShown] = useState(false);
  const [supportedAssetsShown, setSupportedAssetsShown] = useState(false);

  const copy = useCallback(() => {
    if (!address) return;
    selectionAsync().catch(reportError);
    setStringAsync(address)
      .then(() => {
        setCopyAddressShown(true);
      })
      .catch(reportError);
  }, [address]);

  const share = useCallback(async () => {
    if (!address) return;
    await Share.share({
      message: memo ? `${address}\n${t("Memo")}: ${memo}` : address,
      title: t("Share {{chain}} address", { chain: networkName }),
    });
  }, [address, memo, networkName, t]);

  return (
    <SafeView fullScreen>
      <View gap="$s5" fullScreen padded>
        <View gap="$s5">
          <XStack gap="$s3" justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <IconButton
                icon={ArrowLeft}
                aria-label={t("Back")}
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/(main)/(home)");
                  }
                }}
              />
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
            <YStack gap="$s2">
              <XStack gap="$s2">
                <AssetChip
                  assets={assets}
                  isPending={!isBridge && !asset && isPending}
                  onPress={isBridge || asset ? undefined : () => setSupportedAssetsShown(true)}
                />
                <NetworkChip
                  name={networkName}
                  logoURI={isBridge && network in networkLogos ? networkLogos[network] : undefined}
                />
              </XStack>
              <YStack
                backgroundColor="$backgroundSoft"
                borderTopLeftRadius="$r2"
                borderTopRightRadius="$r2"
                borderBottomLeftRadius="$r5"
                borderBottomRightRadius="$r5"
                padding="$s4_5"
                gap="$s4"
              >
                <Text footnote secondary centered>
                  {t("Wallet address")}
                </Text>
                <Pressable hitSlop={15} onPress={copy} disabled={!address}>
                  {address ? (
                    <Text mono title3 centered>
                      {address}
                    </Text>
                  ) : isBridge && isError && !isFetching ? (
                    <Text color="$uiErrorSecondary" centered>
                      {t("Failed to load deposit address.")}
                    </Text>
                  ) : (
                    <Skeleton width="100%" height={54} />
                  )}
                </Pressable>
                {!!address && !memo && (
                  <Pressable role="button" onPress={() => setQRShown(true)}>
                    <XStack alignItems="center" justifyContent="center" gap="$s2">
                      <Text emphasized footnote color="$uiBrandSecondary">
                        {t("Show QR")}
                      </Text>
                      <QrCode size={16} color="$uiBrandSecondary" />
                    </XStack>
                  </Pressable>
                )}
              </YStack>
            </YStack>
            {!!memo && (
              <YStack gap="$s4" backgroundColor="$backgroundSoft" padding="$s4_5" borderRadius="$r3">
                <Text emphasized secondary caption color="$uiNeutralPlaceholder">
                  {t("Memo")}
                </Text>
                <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                  <Text emphasized secondary footnote mono>
                    {memo}
                  </Text>
                  <IconButton
                    icon={Copy}
                    color="$interactiveBaseBrandDefault"
                    aria-label={t("Copy memo")}
                    onPress={() => {
                      if (!memo) return;
                      setStringAsync(memo)
                        .then(() => {
                          toast.show(t("Memo copied!"), {
                            duration: 1000,
                            burntOptions: { haptic: "success" },
                          });
                        })
                        .catch(reportError);
                    }}
                  />
                </XStack>
                <Text caption2 color="$uiNeutralPlaceholder">
                  {t("The memo is required. Deposits sent without it may be permanently lost.")}
                </Text>
              </YStack>
            )}
            {!!address && !memo && (
              <ModalSheet
                open={qrShown}
                onClose={() => {
                  setQRShown(false);
                }}
              >
                <SafeView borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
                  <YStack gap="$s4" alignItems="center" padding="$s5">
                    <Text emphasized headline color="$uiNeutralPrimary">
                      {isBridge
                        ? t("{{network}} deposit address", { network: networkName })
                        : t("Your {{chain}} address", { chain: networkName })}
                    </Text>
                    <YStack padding="$s3" borderRadius="$r4" backgroundColor="white" overflow="hidden">
                      <QRCode
                        data={address}
                        size={200}
                        pieceBorderRadius={2}
                        innerEyesOptions={{ borderRadius: 2 }}
                        isPiecesGlued
                        outerEyesOptions={{ borderRadius: 2 }}
                      />
                    </YStack>
                    <Pressable
                      onPress={() => {
                        setQRShown(false);
                      }}
                    >
                      <Text emphasized footnote color="$uiBrandSecondary">
                        {t("Close")}
                      </Text>
                    </Pressable>
                  </YStack>
                </SafeView>
              </ModalSheet>
            )}
            <CopyAddressSheet
              open={copyAddressShown}
              onClose={() => {
                setCopyAddressShown(false);
              }}
              address={isBridge ? depositAddress : undefined}
              network={isBridge && typeof network === "string" ? network : undefined}
              networkLogo={isBridge && typeof network === "string" ? networkLogos[network] : undefined}
              assets={isBridge || asset ? assets : undefined}
            />
            {!isBridge && !asset && (
              <SupportedAssetsSheet
                open={supportedAssetsShown}
                onClose={() => {
                  setSupportedAssetsShown(false);
                }}
              />
            )}
          </YStack>
        </ScrollView>
        <YStack gap="$s3_5" padding="$s2" paddingTop="$s3">
          {isBridge && <BridgeDisclaimer />}
          <XStack
            backgroundColor="$interactiveBaseWarningSoftDefault"
            borderRadius="$r5"
            paddingHorizontal="$s4"
            paddingVertical="$s3_5"
            gap="$s4"
            alignItems="flex-start"
          >
            <View>
              <AlertTriangle size={16} width={16} height={16} color="$uiWarningSecondary" />
            </View>
            <XStack flex={1}>
              <Text caption2 color="$uiWarningSecondary">
                {isBridge || asset
                  ? t(
                      "Only send {{crypto}} on {{network}}. Sending other assets or using other networks may cause permanent loss.",
                      { crypto: isBridge ? currency : asset, network: networkName },
                    )
                  : t("Only send assets on {{chain}}. Sending funds from other networks may cause permanent loss.", {
                      chain: networkName,
                    })}
                <Text
                  cursor="pointer"
                  caption2
                  primary
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
          {isBridge && isError && !isFetching ? (
            <Button
              secondary
              onPress={() => {
                refetch().catch(reportError);
              }}
            >
              <Button.Text>{t("Retry")}</Button.Text>
              <Button.Icon>
                <RefreshCw size={18 * fontScale} />
              </Button.Icon>
            </Button>
          ) : (
            <XStack alignItems="center" gap="$s3">
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
              <Button primary flex={1} onPress={copy} disabled={!address}>
                <Button.Text>{t("Copy")}</Button.Text>
                <Button.Icon>
                  <Copy size={18 * fontScale} />
                </Button.Icon>
              </Button>
            </XStack>
          )}
        </YStack>
      </View>
    </SafeView>
  );
}

function AssetChip({ assets, isPending, onPress }: { assets: string[]; isPending: boolean; onPress?: () => void }) {
  const { t } = useTranslation();
  return (
    <YStack
      flex={1}
      backgroundColor="$backgroundSoft"
      borderTopLeftRadius="$r5"
      borderTopRightRadius="$r2"
      borderBottomLeftRadius="$r2"
      borderBottomRightRadius="$r2"
      padding="$s4_5"
      gap="$s4"
      cursor={onPress ? "pointer" : undefined}
      onPress={onPress}
    >
      <Text footnote secondary centered>
        {t("Asset")}
      </Text>
      <XStack alignItems="center" justifyContent="center" gap="$s2">
        {isPending ? (
          <Skeleton width={24} height={24} radius="round" />
        ) : assets.length === 1 ? (
          <>
            <AssetLogo symbol={assets[0]} width={24} height={24} />
            <Text emphasized title3 numberOfLines={1}>
              {assets[0]}
            </Text>
          </>
        ) : (
          assets.map((symbol, index) => (
            <XStack key={symbol} marginRight={index < assets.length - 1 ? -12 : 0} zIndex={index}>
              <AssetLogo symbol={symbol} width={24} height={24} />
            </XStack>
          ))
        )}
      </XStack>
    </YStack>
  );
}

function NetworkChip({ logoURI, name }: { logoURI?: string; name: string }) {
  const { t } = useTranslation();
  return (
    <YStack
      flex={1}
      backgroundColor="$backgroundSoft"
      borderTopLeftRadius="$r2"
      borderTopRightRadius="$r5"
      borderBottomLeftRadius="$r2"
      borderBottomRightRadius="$r2"
      padding="$s4_5"
      gap="$s4"
    >
      <Text footnote secondary centered>
        {t("Network")}
      </Text>
      <XStack alignItems="center" justifyContent="center" gap="$s2">
        {logoURI ? (
          <Image source={{ uri: logoURI }} width={24} height={24} borderRadius="$r_0" overflow="hidden" />
        ) : (
          <ChainLogo size={24} />
        )}
        <Text emphasized title3 numberOfLines={1}>
          {name}
        </Text>
      </XStack>
    </YStack>
  );
}
