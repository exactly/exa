import React from "react";
import { Trans } from "react-i18next";
import { XStack } from "tamagui";

import { presentCollection } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import Text from "../shared/Text";

export default function HomeDisclaimer() {
  return (
    <XStack gap="$s4" alignItems="flex-start" paddingTop="$s3" flexWrap="wrap">
      <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
        <Trans
          i18nKey="The <app>Exa App</app> is a self-custody smart wallet. All lending and credit features are decentralized and powered by <protocol>Exactly Protocol</protocol>. <terms>Terms and conditions</terms>."
          components={{
            app: (
              <DisclaimerLink
                onPress={() => {
                  openBrowser(`https://docs.exact.ly/exa-app/how-the-exa-app-works`).catch(reportError);
                }}
              />
            ),
            protocol: (
              <DisclaimerLink
                onPress={() => {
                  openBrowser(`https://exact.ly/`).catch(reportError);
                }}
              />
            ),
            terms: (
              <DisclaimerLink
                onPress={() => {
                  presentCollection("10544608").catch(reportError);
                }}
              />
            ),
          }}
        />
      </Text>
    </XStack>
  );
}

function DisclaimerLink({ onPress, children }: { onPress: () => void; children?: React.ReactNode }) {
  return (
    <Text cursor="pointer" caption2 color="$interactiveOnDisabled" textDecorationLine="underline" onPress={onPress}>
      {children}
    </Text>
  );
}
