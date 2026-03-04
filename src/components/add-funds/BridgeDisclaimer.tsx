import React from "react";
import { Trans, useTranslation } from "react-i18next";

import { Info } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import Text from "../shared/Text";

export default function BridgeDisclaimer({ primary }: { primary?: boolean }) {
  const {
    i18n: { language },
  } = useTranslation();
  return (
    <XStack alignItems="center" gap="$s3">
      <YStack flexShrink={0}>
        <Info size={16} color={primary ? "$uiNeutralPrimary" : "$uiInfoSecondary"} />
      </YStack>
      <YStack flex={1} flexShrink={1}>
        <Text color="$uiNeutralPlaceholder" caption2>
          <Trans
            i18nKey="The deposit services are provided by <provider>Bridge</provider> and are subject to <terms>Terms and Conditions</terms>. Exa Labs SAS does not custody fiat funds."
            components={{
              provider: (
                <Text
                  color="$interactiveTextBrandDefault"
                  caption2
                  cursor="pointer"
                  onPress={() => {
                    openBrowser("https://www.bridge.xyz/").catch(reportError);
                  }}
                />
              ),
              terms: (
                <Text
                  color="$interactiveTextBrandDefault"
                  caption2
                  cursor="pointer"
                  onPress={() => {
                    openBrowser(
                      `https://help.exactly.app/${language.split("-")[0] ?? "en"}/articles/13862897-bridge-terms-and-conditions`,
                    ).catch(reportError);
                  }}
                />
              ),
            }}
          />
        </Text>
      </YStack>
    </XStack>
  );
}
