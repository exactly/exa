import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { CircleCheck, Headset } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Breakdown from "./Breakdown";
import StatementActions from "./StatementActions";
import { present } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useStatement from "../../utils/useStatement";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";

export default function HistorySheet({ maturity, onClose }: { maturity: number | undefined; onClose: () => void }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const { data } = useStatement(maturity);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const close = () => {
    setBreakdownOpen(false);
    onClose();
  };

  const day = (value: number | string) =>
    new Date(typeof value === "number" ? value * 1000 : value).toLocaleDateString(language, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const time = (value: string) => new Date(value).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const paidAt = data
    ?.filter((item) => item.type === "repay")
    .map((item) => item.timestamp)
    .sort()
    .at(-1);
  const paid = paidAt && `${day(paidAt)} - ${time(paidAt)}`;

  return (
    <ModalSheet animation="quick" open={maturity !== undefined} onClose={close}>
      <SafeView
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
        paddingHorizontal="$s5"
        $platform-web={{ paddingVertical: "$s7" }}
        $platform-android={{ paddingBottom: "$s5" }}
      >
        {maturity !== undefined && breakdownOpen ? (
          <Breakdown
            maturity={maturity}
            onBack={() => {
              setBreakdownOpen(false);
            }}
            onViewStatement={() => {
              close();
              router.navigate({ pathname: "/statement", params: { maturity: String(maturity) } });
            }}
          />
        ) : (
          <YStack gap="$s5">
            <XStack gap="$s3" alignItems="center">
              <CircleCheck size={32} color="$uiSuccessSecondary" />
              <YStack flex={1} gap="$s1">
                <Text emphasized headline>
                  {maturity !== undefined && t("Due {{date}}", { date: day(maturity) })}
                </Text>
                {paid && (
                  <Text footnote color="$uiNeutralSecondary">
                    {t("Paid on {{date}}", { date: paid })}
                  </Text>
                )}
              </YStack>
              <IconButton
                icon={Headset}
                aria-label={t("Support")}
                color="$uiNeutralSecondary"
                onPress={() => {
                  present().catch(reportError);
                }}
              />
            </XStack>
            {maturity !== undefined && (
              <StatementActions
                maturity={maturity}
                onBreakdown={() => {
                  setBreakdownOpen(true);
                }}
                onClose={close}
              />
            )}
          </YStack>
        )}
      </SafeView>
    </ModalSheet>
  );
}
