import React from "react";
import { Trans, useTranslation } from "react-i18next";

import { AlertTriangle, X } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function SupportedAssetsSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  const { supportedAssets, isPending } = useMarkets();
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
            <YStack>
              <Text emphasized primary headline>
                {t("Supported assets")}
              </Text>
            </YStack>
            <XStack justifyContent="center" flexWrap="wrap">
              {isPending
                ? Array.from({ length: 5 }, (_, index) => (
                    <Chip key={index}>
                      <Skeleton height={32} width={32} radius="round" />
                      <Skeleton height={16} width={44} />
                    </Chip>
                  ))
                : supportedAssets.map((symbol) => (
                    <Chip key={symbol}>
                      <AssetLogo symbol={symbol} width={32} height={32} />
                      <Text primary emphasized callout>
                        {symbol}
                      </Text>
                    </Chip>
                  ))}
            </XStack>
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
                  <Trans
                    i18nKey="Only send assets on {{chain}}. Sending funds from other networks may cause permanent loss.<learn> Learn more about adding funds.</learn>"
                    values={{ chain: chain.name }}
                    components={{
                      learn: (
                        <Text
                          cursor="pointer"
                          emphasized
                          caption2
                          color="$uiBrandSecondary"
                          onPress={() => {
                            presentArticle("8950801").catch(reportError);
                          }}
                        />
                      ),
                    }}
                  />
                </Text>
              </XStack>
            </XStack>
            <Button primary width="100%" onPress={onClose}>
              <Button.Text>{t("Close")}</Button.Text>
              <Button.Icon>
                <X />
              </Button.Icon>
            </Button>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <XStack
      borderWidth={1}
      alignItems="center"
      borderColor="$borderNeutralSoft"
      borderRadius="$r_0"
      alignSelf="center"
      padding="$s3_5"
      margin="$s3"
      gap="$s2"
    >
      {children}
    </XStack>
  );
}
