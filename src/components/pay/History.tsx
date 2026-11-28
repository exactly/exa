import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ScrollView, XStack, YStack } from "tamagui";

import HistorySheet from "./HistorySheet";
import PaymentList from "./PaymentList";
import { ArrowLeft } from "../../generated/icons/ArrowLeft";
import { refreshNetworks } from "../../utils/networkOptions";
import queryClient from "../../utils/queryClient";
import useStatements from "../../utils/useStatements";
import IconButton from "../shared/IconButton";
import RefreshControl from "../shared/RefreshControl";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function History() {
  const { t } = useTranslation();
  const router = useRouter();
  const past = useStatements();
  const [selected, setSelected] = useState<number>();

  return (
    <SafeView fullScreen backgroundColor="backgroundSoft">
      <View
        padded
        flexDirection="row"
        gap="s3_5"
        paddingBottom="s4"
        alignItems="center"
        backgroundColor="backgroundSoft"
      >
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.dismissTo("/pay-mode");
            }
          }}
        />
      </View>
      <ScrollView
        backgroundColor="backgroundSoft"
        showsVerticalScrollIndicator={false}
        flex={1}
        refreshControl={<RefreshControl onRefresh={refresh} />}
      >
        <XStack paddingHorizontal="s5" paddingBottom="s5" alignItems="center">
          <Text emphasized title3>
            {t("Payment history")}
          </Text>
        </XStack>
        {past?.length === 0 ? (
          <YStack alignItems="center" justifyContent="center" paddingVertical="s7">
            <Text emphasized headline color="uiNeutralSecondary">
              {t("No payments yet")}
            </Text>
          </YStack>
        ) : (
          <YStack paddingHorizontal="s3" paddingBottom="s5">
            <PaymentList past={past} onSelect={setSelected} />
          </YStack>
        )}
      </ScrollView>
      <HistorySheet maturity={selected} onClose={() => setSelected(undefined)} />
    </SafeView>
  );
}

function refresh() {
  return Promise.all([
    refreshNetworks(),
    queryClient.invalidateQueries({ queryKey: ["activity", "card"], exact: true }),
    queryClient.invalidateQueries({ queryKey: ["activity", "statement"] }),
  ]);
}
