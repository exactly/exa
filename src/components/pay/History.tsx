import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowLeft } from "@tamagui/lucide-icons";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import HistorySheet from "./HistorySheet";
import PaymentRow from "./PaymentRow";
import queryClient from "../../utils/queryClient";
import useMarkets from "../../utils/useMarkets";
import useStatements from "../../utils/useStatements";
import IconButton from "../shared/IconButton";
import RefreshControl from "../shared/RefreshControl";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function History() {
  const { t } = useTranslation();
  const router = useRouter();
  const { timestamp, refetch } = useMarkets();
  const maturities = useStatements();
  const [selected, setSelected] = useState<number>();
  const now = Number(timestamp);
  const past = maturities.filter((maturity) => maturity < now);
  const refresh = () =>
    Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ["activity"], exact: true }),
      queryClient.invalidateQueries({ queryKey: ["activity", "statement"] }),
    ]);

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View
        padded
        flexDirection="row"
        gap="$s3_5"
        paddingBottom="$s4"
        alignItems="center"
        backgroundColor="$backgroundSoft"
      >
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            router.back();
          }}
        />
      </View>
      <ScrollView
        backgroundColor="$backgroundSoft"
        showsVerticalScrollIndicator={false}
        flex={1}
        refreshControl={<RefreshControl onRefresh={refresh} />}
      >
        <XStack paddingHorizontal="$s5" paddingBottom="$s5" alignItems="center">
          <Text emphasized title3>
            {t("Payment history")}
          </Text>
        </XStack>
        {past.length === 0 ? (
          <YStack alignItems="center" justifyContent="center" paddingVertical="$s7">
            <Text emphasized headline color="$uiNeutralSecondary">
              {t("No payments yet")}
            </Text>
          </YStack>
        ) : (
          <YStack role="list" paddingHorizontal="$s5" paddingBottom="$s5" gap="$s4">
            {past.map((maturity, index) => (
              <React.Fragment key={maturity}>
                {index > 0 && <Separator borderColor="$borderNeutralSoft" />}
                <PaymentRow maturity={maturity} onSelect={setSelected} />
              </React.Fragment>
            ))}
          </YStack>
        )}
      </ScrollView>
      <HistorySheet maturity={selected} onClose={() => setSelected(undefined)} />
    </SafeView>
  );
}
