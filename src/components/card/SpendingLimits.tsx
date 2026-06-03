import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Plus } from "@tamagui/lucide-icons-2";
import { ScrollView, XStack, YStack } from "tamagui";

import SpendingLimit from "./SpendingLimit";
import InfoAlert from "../shared/InfoAlert";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function SpendingLimits({
  open,
  onClose,
  increase,
  limit,
  spent,
  pending,
  processing,
}: {
  increase: () => void;
  limit?: number;
  onClose: () => void;
  open: boolean;
  pending: boolean;
  processing: boolean;
  spent: number;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <View fullScreen flex={1}>
            <View flex={1} padded>
              <YStack gap="$s4_5">
                <YStack gap="$s4">
                  <Text emphasized headline primary>
                    {t("Spending limits")}
                  </Text>
                  <Text color="$uiNeutralSecondary" subHeadline>
                    {t("Track your spending and see how much you’ve spent with your Exa Card so far.")}
                  </Text>
                </YStack>
                <YStack paddingBottom="$s4">
                  <SpendingLimit title={t("Weekly")} limit={limit} spent={spent} />
                </YStack>
                {processing ? (
                  <InfoAlert
                    title={t(
                      "Your limit increase request is under review. We'll let you know once it's been processed.",
                    )}
                  />
                ) : (
                  <Button
                    onPress={() => {
                      onClose();
                      increase();
                    }}
                    primary
                    disabled={pending}
                    loading={pending}
                  >
                    <Button.Text>{t("Increase spending limit")}</Button.Text>
                    <Button.Icon>
                      <Plus />
                    </Button.Icon>
                  </Button>
                )}
                <XStack alignSelf="center">
                  <Pressable onPress={onClose} hitSlop={20}>
                    <Text emphasized footnote color="$interactiveTextBrandDefault">
                      {t("Close")}
                    </Text>
                  </Pressable>
                </XStack>
              </YStack>
            </View>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
