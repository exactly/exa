import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { AlignJustify, ChevronRight, Download, FileText } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Separator, Spinner, XStack, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import { downloadStatement } from "../../utils/statement";
import Text from "../shared/Text";

export default function StatementActions({
  maturity,
  onBreakdown,
  onClose,
}: {
  maturity: number;
  onBreakdown: () => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const [downloading, setDownloading] = useState(false);

  function download() {
    if (downloading) return;
    setDownloading(true);
    downloadStatement(maturity, `account-statement-${maturity}.pdf`)
      .catch((error: unknown) => {
        reportError(error);
        toast.show(t("Couldn't download your statement. Please try again."), {
          burntOptions: { haptic: "error", preset: "error" },
        });
      })
      .finally(() => {
        setDownloading(false);
      });
  }

  return (
    <YStack>
      <Action icon={AlignJustify} label={t("Breakdown")} onPress={onBreakdown} />
      <Separator borderColor="$borderNeutralSoft" />
      <Action
        icon={FileText}
        label={t("View statement")}
        onPress={() => {
          onClose?.();
          router.navigate({ pathname: "/statement", params: { maturity: String(maturity) } });
        }}
      />
      <Separator borderColor="$borderNeutralSoft" />
      <Action icon={Download} label={t("Download statement")} loading={downloading} onPress={download} />
    </YStack>
  );
}

function Action({
  icon: Icon,
  label,
  loading,
  onPress,
}: {
  icon: typeof FileText;
  label: string;
  loading?: boolean;
  onPress?: () => void;
}) {
  return (
    <XStack
      alignItems="center"
      gap="$s3"
      paddingVertical="$s4"
      aria-label={label}
      aria-disabled={!onPress || loading}
      role={onPress ? "button" : undefined}
      cursor={onPress && !loading ? "pointer" : "default"}
      onPress={loading ? undefined : onPress}
    >
      <Icon size={20} color="$uiNeutralSecondary" />
      <Text flex={1} emphasized subHeadline color="$uiNeutralPrimary">
        {label}
      </Text>
      {loading ? (
        <Spinner color="$interactiveBaseBrandDefault" />
      ) : (
        <ChevronRight size={20} color="$interactiveBaseBrandDefault" />
      )}
    </XStack>
  );
}
