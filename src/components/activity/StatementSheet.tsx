import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Calendar, Check, ChevronDown, Download, FileText } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import { downloadStatement, viewStatement } from "../../utils/statement";
import useStatements from "../../utils/useStatements";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function StatementSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const maturities = useStatements();
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [picking, setPicking] = useState(false);

  const label = (m: number) =>
    new Date(m * 1000).toLocaleDateString(language, { year: "numeric", month: "long", day: "numeric" });
  const maturity = selected ?? maturities[0];
  const period = maturity === undefined ? undefined : label(maturity);

  function run(action: (maturity: number, filename: string) => Promise<void>) {
    if (maturity === undefined || loading) return;
    setLoading(true);
    action(maturity, `account-statement-${maturity}.pdf`)
      .catch(reportError)
      .finally(() => {
        setLoading(false);
      });
  }

  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
        paddingHorizontal="$s5"
        $platform-web={{ paddingVertical: "$s7" }}
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s6">
          <YStack gap="$s2">
            <Text emphasized primary headline>
              {t("Download account statement")}
            </Text>
            <Text subHeadline color="$uiNeutralSecondary">
              {t("Select a time period and format.")}
            </Text>
          </YStack>

          <YStack gap="$s5">
            <YStack gap="$s3">
              <XStack
                alignItems="center"
                justifyContent="space-between"
                cursor={maturities.length > 1 ? "pointer" : "default"}
                onPress={() => {
                  if (maturities.length > 1) setPicking((value) => !value);
                }}
              >
                <XStack gap="$s3" alignItems="center">
                  <Calendar size={20} color="$uiNeutralSecondary" />
                  <Text emphasized subHeadline>
                    {t("Period")}
                  </Text>
                </XStack>
                <XStack gap="$s2" alignItems="center">
                  <Text emphasized subHeadline color={period ? "$uiNeutralPrimary" : "$uiNeutralSecondary"}>
                    {period ?? t("No statements")}
                  </Text>
                  {maturities.length > 1 && (
                    <ChevronDown size={20} color="$uiNeutralSecondary" rotate={picking ? "180deg" : "0deg"} />
                  )}
                </XStack>
              </XStack>

              {picking && (
                <YStack gap="$s2">
                  {maturities.map((option) => {
                    const active = option === maturity;
                    return (
                      <XStack
                        key={option}
                        alignItems="center"
                        gap="$s3"
                        padding="$s3"
                        borderRadius="$r3"
                        cursor="pointer"
                        backgroundColor={active ? "$interactiveBaseBrandSoftDefault" : "$backgroundMild"}
                        onPress={() => {
                          setSelected(option);
                          setPicking(false);
                        }}
                      >
                        <XStack
                          width={20}
                          height={20}
                          borderRadius={10}
                          alignItems="center"
                          justifyContent="center"
                          backgroundColor={active ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
                        >
                          {active && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                        </XStack>
                        <Text emphasized subHeadline color="$uiNeutralPrimary">
                          {label(option)}
                        </Text>
                      </XStack>
                    );
                  })}
                </YStack>
              )}
            </YStack>

            <XStack alignItems="center" justifyContent="space-between">
              <XStack gap="$s3" alignItems="center">
                <FileText size={20} color="$uiNeutralSecondary" />
                <YStack gap="$s1">
                  <Text emphasized subHeadline>
                    {t("Format")}
                  </Text>
                  <Text footnote color="$uiNeutralSecondary">
                    {t("Better for reading or sharing")}
                  </Text>
                </YStack>
              </XStack>
              <XStack gap="$s2" alignItems="center">
                <Text emphasized subHeadline>
                  PDF
                </Text>
                <ChevronDown size={20} color="$uiNeutralSecondary" />
              </XStack>
            </XStack>
          </YStack>

          <YStack gap="$s4">
            <Button
              primary
              loading={loading}
              disabled={maturity === undefined || loading}
              onPress={() => {
                run(downloadStatement);
              }}
            >
              <Button.Text>{t("Download PDF")}</Button.Text>
              <Button.Icon>
                <Download />
              </Button.Icon>
            </Button>
            {maturity !== undefined && (
              <XStack
                justifyContent="center"
                cursor="pointer"
                paddingVertical="$s1"
                onPress={() => {
                  run(viewStatement);
                }}
              >
                <Text emphasized footnote color="$interactiveBaseBrandDefault">
                  {t("View")}
                </Text>
              </XStack>
            )}
            <XStack justifyContent="center" cursor="pointer" paddingVertical="$s1" onPress={onClose}>
              <Text emphasized footnote color="$interactiveBaseBrandDefault">
                {t("Close")}
              </Text>
            </XStack>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
