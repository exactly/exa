import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ThumbsUp } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function OtherNetworksSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
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
            <Text emphasized primary headline>
              {t("Other networks")}
            </Text>
            <Text subHeadline secondary>
              {t(
                "Assets from these networks need to be bridged to {{chain}}. Some may also require a swap to a supported asset to generate yield and increase your Exa Card credit limit. You can do both from your Portfolio.",
                { chain: chain.name },
              )}
            </Text>
            <Button primary width="100%" onPress={onClose}>
              <Button.Text adjustsFontSizeToFit={false}>{t("Got it!")}</Button.Text>
              <Button.Icon>
                <ThumbsUp />
              </Button.Icon>
            </Button>
            <Pressable
              onPress={() => {
                presentArticle("8950801").catch(reportError);
              }}
            >
              <Text emphasized footnote color="$uiBrandSecondary" centered>
                {t("Learn more")}
              </Text>
            </Pressable>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
