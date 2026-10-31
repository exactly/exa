import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { AlignJustify } from "@tamagui/lucide-icons-2/icons/AlignJustify";
import { ChevronRight } from "@tamagui/lucide-icons-2/icons/ChevronRight";
import { FileText } from "@tamagui/lucide-icons-2/icons/FileText";
import { getTokens, Separator, YStack } from "tamagui";

import Button from "../shared/StyledButton";

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
  return (
    <YStack>
      <Action icon={AlignJustify} label={t("Breakdown")} onPress={onBreakdown} />
      <Separator borderColor="borderNeutralSoft" />
      <Action
        icon={FileText}
        label={t("View statement")}
        onPress={() => {
          onClose?.();
          router.navigate({ pathname: "/statement", params: { maturity: String(maturity) } });
        }}
      />
    </YStack>
  );
}

function Action({ icon: Icon, label, onPress }: { icon: typeof FileText; label: string; onPress: () => void }) {
  return (
    <Button
      transparent
      gap="s3"
      minHeight="s0"
      paddingHorizontal="s0"
      paddingVertical="s4"
      aria-label={label}
      onPress={onPress}
    >
      <Icon size={20} color="uiNeutralSecondary" />
      <Button.Text color="uiNeutralPrimary">{label}</Button.Text>
      <Button.Icon>
        <ChevronRight size={getTokens().iconSize.md.val} color="interactiveBaseBrandDefault" />
      </Button.Icon>
    </Button>
  );
}
