import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ArrowRight, Check, Info } from "@tamagui/lucide-icons";
import { Checkbox, ScrollView, Separator, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ReceiveGuideSheet({
  asset,
  chainId,
  network,
  onClose,
  onContinue,
  open,
  variant,
}: {
  asset: string;
  chainId?: number;
  network: string;
  onClose: () => void;
  onContinue: (hide: boolean) => void;
  open: boolean;
  variant: "bridge" | "bridgeSwap" | "swap";
}) {
  const { t } = useTranslation();
  const { supportedAssets } = useMarkets();
  const [hide, setHide] = useState(false);
  const learn = (
    <Text
      caption2
      color="$uiBrandSecondary"
      cursor="pointer"
      onPress={() => {
        presentArticle("8950805").catch(reportError);
      }}
    />
  );
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
            <Text emphasized primary headline>
              {variant === "bridge"
                ? t("Bridge needed after receiving")
                : variant === "swap"
                  ? t("Swap needed after receiving")
                  : t("Bridge and swap needed after receiving")}
            </Text>
            <XStack
              backgroundColor="$backgroundStrong"
              borderRadius="$r3"
              paddingVertical="$s5"
              paddingHorizontal="$s3_5"
              justifyContent="center"
              alignItems="center"
              gap="$s3_5"
            >
              <View position="relative">
                <AssetLogo symbol={asset} width={48} height={48} />
                <View position="absolute" bottom={-4} right={-4}>
                  <ChainLogo chainId={chainId} size={24} borderRadius="$r_0" />
                </View>
              </View>
              <ArrowRight size={24} color="$uiNeutralSecondary" />
              <View position="relative">
                {variant === "bridge" ? (
                  <AssetLogo symbol={asset} width={48} height={48} />
                ) : (
                  <XStack>
                    {supportedAssets.map((symbol, index) => (
                      <XStack key={symbol} marginRight={index < supportedAssets.length - 1 ? -16 : 0} zIndex={index}>
                        <AssetLogo symbol={symbol} width={48} height={48} />
                      </XStack>
                    ))}
                  </XStack>
                )}
                <View position="absolute" bottom={-4} right={-4}>
                  <ChainLogo size={24} borderRadius="$r_0" />
                </View>
              </View>
            </XStack>
            <YStack gap="$s4_5">
              <Step index={1} text={t("Once received, go to your Portfolio.")} />
              <Step index={2} text={t("Find {{asset}} on {{network}} and select it.", { asset, network })} />
              <Step
                index={3}
                text={
                  variant === "bridge"
                    ? t("Bridge it to {{asset}} on {{chain}}.", { asset, chain: chain.name })
                    : variant === "swap"
                      ? t("Swap it to a supported asset on {{chain}}.", { chain: chain.name })
                      : t("Bridge and swap it to a supported asset on {{chain}}.", { chain: chain.name })
                }
              />
            </YStack>
            <Separator borderColor="$borderNeutralSoft" />
            <XStack gap="$s4" alignItems="flex-start">
              <View>
                <Info size={16} color="$uiInfoSecondary" />
              </View>
              <Text caption2 color="$uiNeutralPlaceholder" flex={1}>
                {variant === "bridge" ? (
                  <Trans
                    i18nKey="{{asset}} on {{network}} isn't a supported collateral asset. To earn yield and increase your Exa Card credit limit, you'll need to bridge it to {{asset}} on {{chain}}.<learn> Learn more.</learn>"
                    values={{ asset, network, chain: chain.name }}
                    components={{ learn }}
                  />
                ) : variant === "swap" ? (
                  <Trans
                    i18nKey="{{asset}} on {{chain}} isn't a supported collateral asset. To earn yield and increase your Exa Card credit limit, you'll need to swap it to a supported asset.<learn> Learn more.</learn>"
                    values={{ asset, chain: chain.name }}
                    components={{ learn }}
                  />
                ) : (
                  <Trans
                    i18nKey="{{asset}} on {{network}} isn't a supported collateral asset. To earn yield and increase your Exa Card credit limit, you'll need to bridge it to {{chain}} and swap it to a supported asset.<learn> Learn more.</learn>"
                    values={{ asset, network, chain: chain.name }}
                    components={{ learn }}
                  />
                )}
              </Text>
            </XStack>
            <Button primary width="100%" onPress={() => onContinue(hide)}>
              <Button.Text adjustsFontSizeToFit={false}>{t("Continue")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
            <Pressable onPress={() => setHide(!hide)}>
              <XStack gap="$s3" alignItems="center" justifyContent="center">
                <Checkbox
                  pointerEvents="none"
                  borderColor={hide ? "$backgroundBrand" : "$uiNeutralSecondary"}
                  backgroundColor={hide ? "$backgroundBrand" : "transparent"}
                  checked={hide}
                >
                  <Checkbox.Indicator>
                    <Check size={16} color="$interactiveOnBaseBrandDefault" />
                  </Checkbox.Indicator>
                </Checkbox>
                <Text footnote secondary>
                  {t("Don't show again")}
                </Text>
              </XStack>
            </Pressable>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}

function Step({ index, text }: { index: number; text: string }) {
  return (
    <XStack gap="$s3_5" alignItems="center">
      <View
        width={24}
        height={24}
        borderRadius="$r_0"
        backgroundColor="$interactiveBaseBrandSoftDefault"
        alignItems="center"
        justifyContent="center"
      >
        <Text emphasized subHeadline color="$interactiveOnBaseBrandSoft">
          {index}
        </Text>
      </View>
      <Text subHeadline secondary flex={1}>
        {text}
      </Text>
    </XStack>
  );
}
