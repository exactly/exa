import { Download } from "@tamagui/lucide-icons";
import React from "react";
import { Linking, Platform } from "react-native";
import { YStack } from "tamagui";

import reportError from "../../utils/reportError";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function UpdateAppSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <YStack paddingHorizontal="$s5" paddingVertical="$s7" gap="$s7" backgroundColor="$backgroundSoft">
        <YStack gap="$s5">
          <Text headline emphasized>
            New version available
          </Text>
          <Text subHeadline secondary>
            Update the Exa App to get the latest improvements and stay up to date. Some features, like contacting
            support, are available only on the latest version.
          </Text>
        </YStack>
        <YStack gap="$s5">
          <Button
            primary
            onPress={() => {
              Linking.openURL(
                Platform.OS === "ios"
                  ? "https://apps.apple.com/app/id6572315454"
                  : "https://play.google.com/store/apps/details?id=app.exactly",
              ).catch(reportError);
            }}
          >
            <Button.Text>Update Exa App</Button.Text>
            <Button.Icon>
              <Download />
            </Button.Icon>
          </Button>
          <YStack
            role="button"
            onPress={onClose}
            hitSlop={15}
            cursor="pointer"
            pressStyle={{ opacity: 0.7 }} // eslint-disable-line react-native/no-inline-styles
          >
            <Text emphasized footnote textAlign="center" color="$interactiveBaseBrandDefault">
              I&apos;ll update later
            </Text>
          </YStack>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
