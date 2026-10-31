import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CircleCheck } from "@tamagui/lucide-icons-2/icons/CircleCheck";
import { FileText } from "@tamagui/lucide-icons-2/icons/FileText";
import { Headset } from "@tamagui/lucide-icons-2/icons/Headset";
import { getTokens, XStack, YStack } from "tamagui";

import Breakdown from "./Breakdown";
import StatementActions from "./StatementActions";
import { present } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import statement from "../../utils/statement";
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
  const [displayMaturity, setDisplayMaturity] = useState(maturity);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  if (maturity !== undefined && maturity !== displayMaturity) {
    setDisplayMaturity(maturity);
    setBreakdownOpen(false);
  }
  const { data } = useStatement(displayMaturity);
  const { payments, due } = useMemo(() => statement(data ?? []), [data]);

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
  const paidAt = due < 0.005 ? payments.at(-1)?.timestamp : undefined;
  const paid = paidAt && `${day(paidAt)} - ${time(paidAt)}`;

  return (
    <ModalSheet open={maturity !== undefined} onClose={close}>
      <SafeView
        borderTopLeftRadius="r4"
        borderTopRightRadius="r4"
        backgroundColor="backgroundSoft"
        paddingHorizontal="s5"
        paddingTop="web:s7"
        paddingBottom="web:s7 android:s5"
      >
        {displayMaturity !== undefined && breakdownOpen ? (
          <Breakdown
            maturity={displayMaturity}
            onBack={() => {
              setBreakdownOpen(false);
            }}
            onClose={close}
          />
        ) : (
          <YStack gap="s5">
            <XStack gap="s3" alignItems="center">
              {paidAt ? (
                <CircleCheck size={getTokens().iconSize.xl.val} color="uiSuccessSecondary" />
              ) : (
                <FileText size={getTokens().iconSize.xl.val} color="uiNeutralSecondary" />
              )}
              <YStack flex={1} gap="s1">
                <Text emphasized headline>
                  {displayMaturity !== undefined && t("Due {{date}}", { date: day(displayMaturity) })}
                </Text>
                {paid && (
                  <Text footnote color="uiNeutralSecondary">
                    {t("Paid on {{date}}", { date: paid })}
                  </Text>
                )}
              </YStack>
              <IconButton
                icon={Headset}
                aria-label={t("Support")}
                color="uiNeutralSecondary"
                onPress={() => {
                  present().catch(reportError);
                }}
              />
            </XStack>
            {displayMaturity !== undefined && (
              <StatementActions
                maturity={displayMaturity}
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
