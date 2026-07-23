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

export default function OtherAssetsSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
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
              {t("Other assets")}
            </Text>
            <Text subHeadline secondary>
              {t(
                "You can hold these assets, but they don't earn yield or increase your Exa Card credit limit. Go to your Portfolio to swap or bridge them to a supported asset on {{chain}}.",
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
                presentArticle("8950805").catch(reportError);
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
