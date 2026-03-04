import React from "react";
import { useTranslation } from "react-i18next";

import { CheckCircle, X } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import AssetLogo from "./AssetLogo";
import ChainLogo from "./ChainLogo";
import Image from "./Image";
import ModalSheet from "./ModalSheet";
import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";

const supportedAssets = Object.keys(assetLogos).filter((s) => s !== "USDC.e" && s !== "DAI");

export default function CopyAddressSheet({
  open,
  onClose,
  address: overrideAddress,
  network,
  networkLogo,
  assets,
}: {
  address?: string;
  assets?: string[];
  network?: string;
  networkLogo?: string;
  onClose: () => void;
  open: boolean;
}) {
  const { address: accountAddress } = useAccount();
  const displayAssets = assets ?? supportedAssets;
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <ScrollView $platform-web={{ maxHeight: "100vh" }}>
        <SafeView
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s5"
          $platform-web={{ paddingVertical: "$s7" }}
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <YStack gap="$s7">
            <YStack gap="$s5">
              <XStack gap="$s3" alignItems="center">
                <CheckCircle size={24} color="$uiSuccessSecondary" />
                <Text emphasized primary headline color="$uiSuccessSecondary">
                  {t("Address copied")}
                </Text>
              </XStack>
              <Text emphasized secondary subHeadline>
                {t("Double-check your address before sending funds to avoid losing them.")}
              </Text>
            </YStack>
            <Text primary title2 mono textAlign="center">
              {overrideAddress ?? accountAddress}
            </Text>
            <YStack
              gap="$s5"
              alignItems="flex-start"
              borderTopWidth={1}
              borderTopColor="$borderNeutralSoft"
              paddingTop="$s5"
            >
              <XStack justifyContent="space-between" alignItems="center" width="100%">
                <Text emphasized footnote color="$uiNeutralSecondary" textAlign="left">
                  {t("Network")}
                </Text>
                <Text emphasized footnote color="$uiNeutralSecondary" textAlign="right">
                  {displayAssets.length === 1 ? t("Asset") : t("Supported Assets")}
                </Text>
              </XStack>
              <XStack gap="$s5" justifyContent="space-between" alignItems="center" width="100%">
                <XStack alignItems="center" gap="$s3" flex={1}>
                  {networkLogo ? (
                    <Image source={{ uri: networkLogo }} width={32} height={32} borderRadius="$r_0" overflow="hidden" />
                  ) : (
                    <ChainLogo size={32} />
                  )}
                  <Text emphasized primary headline>
                    {network ?? chain.name}
                  </Text>
                </XStack>
                <XStack
                  borderWidth={1}
                  borderColor="$borderNeutralSoft"
                  borderRadius="$r_0"
                  padding="$s3_5"
                  alignSelf="flex-end"
                >
                  {displayAssets.map((symbol, index) => (
                    <XStack key={symbol} marginRight={index < displayAssets.length - 1 ? -12 : 0} zIndex={index}>
                      <AssetLogo symbol={symbol} width={32} height={32} />
                    </XStack>
                  ))}
                </XStack>
              </XStack>
            </YStack>
            <Button
              onPress={onClose}
              flexBasis={60}
              contained
              main
              spaced
              fullwidth
              iconAfter={<X strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
            >
              {t("Close")}
            </Button>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
