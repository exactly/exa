import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ArrowRight, Check, Info } from "@tamagui/lucide-icons";
import { Checkbox, ScrollView, Separator, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function BridgeNeededSheet({
  asset,
  chainId,
  network,
  onClose,
  onContinue,
  open,
}: {
  asset: string;
  chainId?: number;
  network: string;
  onClose: () => void;
  onContinue: (hide: boolean) => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const [hide, setHide] = useState(false);
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
              {t("Bridge needed after receiving")}
            </Text>
            <XStack
              backgroundColor="$backgroundMild"
              borderRadius="$r4"
              padding="$s4_5"
              justifyContent="center"
              alignItems="center"
              gap="$s4"
            >
              <View position="relative">
                <AssetLogo symbol={asset} width={40} height={40} />
                <View position="absolute" bottom={-4} right={-4}>
                  <ChainLogo chainId={chainId} size={16} borderRadius="$r_0" />
                </View>
              </View>
              <ArrowRight size={24} color="$uiNeutralSecondary" />
              <View position="relative">
                <AssetLogo symbol={asset} width={40} height={40} />
                <View position="absolute" bottom={-4} right={-4}>
                  <ChainLogo size={16} borderRadius="$r_0" />
                </View>
              </View>
            </XStack>
            <YStack gap="$s4">
              <Step index={1} text={t("Once received, go to your Portfolio.")} />
              <Step index={2} text={t("Find {{asset}} on {{network}} and select it.", { asset, network })} />
              <Step index={3} text={t("Bridge it to {{asset}} on {{chain}}.", { asset, chain: chain.name })} />
            </YStack>
            <Separator borderColor="$borderNeutralSoft" />
            <XStack gap="$s3" alignItems="flex-start">
              <View>
                <Info size={16} color="$uiInfoSecondary" />
              </View>
              <Text caption color="$uiNeutralSecondary" flex={1}>
                <Trans
                  i18nKey="{{asset}} on {{network}} isn't a supported collateral asset. To earn yield and increase your Exa Card credit limit, you'll need to bridge it to {{asset}} on {{chain}}.<learn> Learn more.</learn>"
                  values={{ asset, network, chain: chain.name }}
                  components={{
                    learn: (
                      <Text
                        caption
                        emphasized
                        color="$uiBrandSecondary"
                        cursor="pointer"
                        onPress={() => {
                          presentArticle("8950805").catch(reportError);
                        }}
                      />
                    ),
                  }}
                />
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
        backgroundColor="$interactiveBaseSuccessSoftDefault"
        alignItems="center"
        justifyContent="center"
      >
        <Text emphasized caption color="$interactiveOnBaseSuccessSoft">
          {index}
        </Text>
      </View>
      <Text subHeadline primary flex={1}>
        {text}
      </Text>
    </XStack>
  );
}
