import { X } from "@tamagui/lucide-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import useOpenBrowser from "../../utils/useOpenBrowser";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AboutDefiSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openBrowser = useOpenBrowser();
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <View fullScreen flex={1}>
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack gap="$s4_5">
                <YStack gap="$s4">
                  <Text headline emphasized>
                    {t("About DeFi")}
                  </Text>
                  <Text subHeadline color="$uiNeutralPlaceholder">
                    {t(
                      "Here you’ll find integrations with decentralized services powered by our partners. Exa App never controls your assets or how you use them when connected to the integrations provided by our partners.",
                    )}
                  </Text>

                  <Button
                    flexBasis={60}
                    onPress={onClose}
                    contained
                    main
                    spaced
                    fullwidth
                    iconAfter={<X strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
                  >
                    {t("Close")}
                  </Button>
                  <Text
                    footnote
                    emphasized
                    color="$interactiveTextBrandDefault"
                    cursor="pointer"
                    textAlign="center"
                    onPress={() => {
                      openBrowser(
                        `https://intercom.help/exa-app/en/articles/9942510-exa-app-terms-and-conditions`,
                      ).catch(reportError);
                    }}
                  >
                    {t("Learn more about integrations")}
                  </Text>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
