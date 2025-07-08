import chain from "@exactly/common/generated/chain";
import { CheckCircle, X } from "@tamagui/lucide-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, XStack, YStack } from "tamagui";

import AssetLogo from "./AssetLogo";
import ModalSheet from "./ModalSheet";
import OptimismImage from "../../assets/images/optimism.svg";
import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";

const supportedAssets = Object.entries(assetLogos)
  .filter(([symbol]) => symbol !== "USDC.e" && symbol !== "DAI")
  .map(([symbol, image]) => ({ symbol, image }));

export default function CopyAddressSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount();
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
            <Text primary title fontFamily="$mono" textAlign="center">
              {address}
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
                  {t("Supported Assets")}
                </Text>
              </XStack>
              <XStack gap="$s5" justifyContent="space-between" alignItems="center" width="100%">
                <XStack alignItems="center" gap="$s3" flex={1}>
                  <OptimismImage height={32} width={32} />
                  <Text emphasized primary headline>
                    {chain.name}
                  </Text>
                </XStack>
                <XStack
                  borderWidth={1}
                  borderColor="$borderNeutralSoft"
                  borderRadius="$r_0"
                  padding="$s3_5"
                  alignSelf="flex-end"
                >
                  {supportedAssets.map(({ symbol, image }, index) => {
                    return (
                      <XStack key={symbol} marginRight={index < supportedAssets.length - 1 ? -12 : 0} zIndex={index}>
                        <AssetLogo source={{ uri: image }} width={32} height={32} />
                      </XStack>
                    );
                  })}
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
