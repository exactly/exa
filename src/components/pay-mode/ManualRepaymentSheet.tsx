import { ArrowRight, Check } from "@tamagui/lucide-icons";
import React, { useState } from "react";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ManualRepaymentSheet({
  open,
  onClose,
  onActionPress,
}: {
  open: boolean;
  onClose: () => void;
  onActionPress: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(true);
  return (
    <ModalSheet key={open ? "open" : "closed"} open={open} onClose={onClose} disableDrag>
      <SafeView
        paddingTop={0}
        $platform-web={{ paddingBottom: "$s4" }}
        fullScreen
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
      >
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <View fullScreen flex={1}>
            <YStack flex={1} paddingHorizontal="$s5" paddingTop="$s7" gap="$s4">
              <YStack flex={1} gap="$s5">
                <Text emphasized headline>
                  How installment repayment works
                </Text>
                <Text subHeadline secondary>
                  When you make a purchase using an installment plan,
                  <Text color="$uiInfoSecondary">
                    &nbsp;you must repay each installment manually before its due date.&nbsp;
                  </Text>
                  If not, a 0.45% penalty is added every day the payment is late.
                </Text>
              </YStack>
              <Separator height={1} borderColor="$borderNeutralSoft" paddingVertical="$s2" />
              <YStack gap="$s4_5">
                <XStack
                  alignItems="center"
                  gap="$s4"
                  flex={1}
                  justifyContent="flex-start"
                  onPress={() => {
                    setAcknowledged(!acknowledged);
                  }}
                >
                  <XStack cursor="pointer" gap="$s3" flex={1} alignItems="center">
                    <View
                      width={16}
                      height={16}
                      backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                      borderColor="$backgroundBrand"
                      borderWidth={1}
                      borderRadius="$r2"
                      justifyContent="center"
                      alignItems="center"
                    >
                      {acknowledged && <Check size="$iconSize.xs" color="white" />}
                    </View>
                    <Text color="$uiNeutralSecondary" caption flex={1}>
                      I understand I have to repay each installment before the due date to avoid daily penalties.
                    </Text>
                  </XStack>
                </XStack>
                <Button onPress={onActionPress} primary disabled={!acknowledged}>
                  <Button.Text>Close</Button.Text>
                  <Button.Icon>
                    <ArrowRight />
                  </Button.Icon>
                </Button>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
