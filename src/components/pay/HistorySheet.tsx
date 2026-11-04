import React, { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Check } from "@tamagui/lucide-icons-2/icons/Check";
import { FileText } from "@tamagui/lucide-icons-2/icons/FileText";
import { Headset } from "@tamagui/lucide-icons-2/icons/Headset";
import { Separator, Square, XStack, YStack } from "tamagui";

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
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        {displayMaturity !== undefined && breakdownOpen ? (
          <YStack paddingHorizontal="$s5" $platform-web={{ paddingVertical: "$s7" }}>
            <Breakdown
              maturity={displayMaturity}
              onBack={() => {
                setBreakdownOpen(false);
              }}
              onClose={close}
            />
          </YStack>
        ) : (
          <YStack>
            <XStack gap="$s4" alignItems="center" paddingHorizontal="$s5" paddingTop="$s6" paddingBottom="$s4_5">
              <Square size="$s8" borderRadius="$r4" backgroundColor="$backgroundStrong">
                {paidAt ? (
                  <Check size={32} color="$uiSuccessSecondary" />
                ) : (
                  <FileText size={32} color="$uiNeutralSecondary" />
                )}
              </Square>
              <YStack flex={1} gap="$s3_5">
                {displayMaturity !== undefined && (
                  <Text body secondary>
                    <Trans
                      i18nKey="Due <date>{{date}}</date>"
                      values={{ date: day(displayMaturity) }}
                      components={{ date: <Text body emphasized /> }}
                    />
                  </Text>
                )}
                {paid && (
                  <Text caption secondary>
                    {t("Paid on {{date}}", { date: paid })}
                  </Text>
                )}
              </YStack>
              <IconButton
                icon={Headset}
                aria-label={t("Support")}
                color="$interactiveBaseBrandDefault"
                onPress={() => {
                  present().catch(reportError);
                }}
              />
            </XStack>
            <Separator borderColor="$borderNeutralSoft" />
            {displayMaturity !== undefined && (
              <YStack paddingHorizontal="$s3" paddingBottom="$s4_5">
                <StatementActions
                  maturity={displayMaturity}
                  onBreakdown={() => {
                    setBreakdownOpen(true);
                  }}
                  onClose={close}
                />
              </YStack>
            )}
          </YStack>
        )}
      </SafeView>
    </ModalSheet>
  );
}
