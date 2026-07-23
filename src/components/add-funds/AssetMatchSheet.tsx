import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ArrowRight, Check, CheckCircle } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetMatchSheet({
  destinationSymbol,
  onClose,
  onConfirm,
  onSelectAnother,
  open,
  sourceChainId,
  sourceLogoURI,
  sourceNetwork,
  sourceSymbol,
}: {
  destinationSymbol: string;
  onClose: () => void;
  onConfirm: () => void;
  onSelectAnother: () => void;
  open: boolean;
  sourceChainId?: number;
  sourceLogoURI?: string;
  sourceNetwork: string;
  sourceSymbol: string;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <ScrollView showsVerticalScrollIndicator={false} $platform-web={{ maxHeight: "100vh" }}>
        <SafeView
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s5"
          $platform-web={{ paddingVertical: "$s7" }}
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <YStack gap="$s5">
            <XStack gap="$s3" alignItems="center">
              <CheckCircle size={20} color="$uiBrandSecondary" />
              <Text emphasized primary headline>
                {t("Supported asset match")}
              </Text>
            </XStack>
            <Text subHeadline secondary>
              {t(
                "{{source}} on {{network}} matches {{destination}} on {{chain}}. You can swap and bridge between these assets or just select another supported asset.",
                { source: sourceSymbol, network: sourceNetwork, destination: destinationSymbol, chain: chain.name },
              )}
            </Text>
            <XStack justifyContent="center" alignItems="center" gap="$s5" paddingVertical="$s4">
              <View position="relative">
                <AssetLogo symbol={sourceSymbol} uri={sourceLogoURI} width={48} height={48} />
                <View position="absolute" bottom={-4} right={-4}>
                  <ChainLogo chainId={sourceChainId} size={20} borderRadius="$r_0" />
                </View>
              </View>
              <ArrowRight size={24} color="$uiBrandSecondary" />
              <View position="relative">
                <AssetLogo symbol={destinationSymbol} width={48} height={48} />
                <View position="absolute" bottom={-4} right={-4}>
                  <ChainLogo size={20} borderRadius="$r_0" />
                </View>
              </View>
            </XStack>
            <Button primary width="100%" onPress={onConfirm}>
              <Button.Text adjustsFontSizeToFit={false}>
                {t("Swap and bridge {{source}} to {{destination}}", {
                  source: sourceSymbol,
                  destination: destinationSymbol,
                })}
              </Button.Text>
              <Button.Icon>
                <Check />
              </Button.Icon>
            </Button>
            <Pressable onPress={onSelectAnother}>
              <Text emphasized footnote color="$uiBrandSecondary" centered>
                {t("Select another asset")}
              </Text>
            </Pressable>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
