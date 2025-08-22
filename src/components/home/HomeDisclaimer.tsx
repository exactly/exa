import React from "react";
import { XStack } from "tamagui";

import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import useOpenBrowser from "../../utils/useOpenBrowser";
import Text from "../shared/Text";

export default function HomeDisclaimer() {
  const openBrowser = useOpenBrowser();
  const { presentCollection } = useIntercom();
  return (
    <XStack gap="$s4" alignItems="flex-start" paddingTop="$s3" flexWrap="wrap">
      <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
        The&nbsp;
        <Text
          cursor="pointer"
          caption2
          color="$interactiveOnDisabled"
          textDecorationLine="underline"
          onPress={() => {
            openBrowser(`https://docs.exact.ly/exa-app/how-the-exa-app-works`).catch(reportError);
          }}
        >
          Exa App
        </Text>
        &nbsp;is a self-custodial smart wallet. All borrowing and lending features are decentralized and powered
        by&nbsp;
        <Text
          cursor="pointer"
          caption2
          color="$interactiveOnDisabled"
          textDecorationLine="underline"
          onPress={() => {
            openBrowser(`https://exact.ly/`).catch(reportError);
          }}
        >
          Exactly Protocol
        </Text>
        .&nbsp;
        <Text
          cursor="pointer"
          caption2
          color="$interactiveOnDisabled"
          textDecorationLine="underline"
          onPress={() => {
            presentCollection("10544608").catch(reportError);
          }}
        >
          Terms and conditions
        </Text>
        .
      </Text>
    </XStack>
  );
}
