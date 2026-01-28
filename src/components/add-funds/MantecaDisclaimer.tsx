import React from "react";
import { Trans } from "react-i18next";

import { Info } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import Text from "../shared/Text";

export default function MantecaDisclaimer({ primary }: { primary?: boolean }) {
  return (
    <XStack alignItems="center" gap="$s3">
      <Info size={24} color={primary ? "$uiNeutralPrimary" : "$uiInfoSecondary"} />
      <YStack flex={1} flexShrink={1}>
        <Text color="$uiNeutralPlaceholder" caption2>
          <Trans
            i18nKey="The fiat deposit services are provided by <provider>Manteca</provider> (Sixalime SAS) and are subject to <terms>Terms and Conditions</terms>. Exa Labs SAS does not custody fiat funds."
            components={{
              provider: (
                <Text
                  color="$interactiveTextBrandDefault"
                  caption2
                  cursor="pointer"
                  onPress={() => {
                    openBrowser("https://manteca.dev/").catch(reportError);
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
                      "https://help.exactly.app/en/articles/13616694-fiat-on-ramp-terms-and-conditions",
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
