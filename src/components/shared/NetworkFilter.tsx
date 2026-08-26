import React, { useState, type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";

import { ChevronDown } from "@tamagui/lucide-icons";
import { XStack } from "tamagui";

import ChainLogo from "./ChainLogo";
import SelectSheet from "./SelectSheet";
import View from "./View";

export default function NetworkFilter({
  chains,
  value,
  onChange,
  all = true,
  size = 18,
  ...properties
}: ComponentPropsWithoutRef<typeof XStack> & {
  all?: boolean;
  chains: { id: number; name: string }[];
  onChange: (chainId: number | undefined) => void;
  size?: number;
  value?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <XStack
        alignItems="center"
        gap="$s2"
        padding="$s3_5"
        backgroundColor="$backgroundMild"
        cursor="pointer"
        role="button"
        aria-label={t("Select network")}
        pressStyle={{ opacity: 0.7 }}
        {...properties}
        onPress={() => {
          setOpen(true);
        }}
      >
        {value === undefined ? (
          <View width={size} height={size} flexDirection="row" flexWrap="wrap" gap={2}>
            {chains.slice(0, 4).map((item) => (
              <ChainLogo key={item.id} chainId={item.id} size={size / 2 - 1} />
            ))}
          </View>
        ) : (
          <ChainLogo chainId={value} size={size} />
        )}
        <ChevronDown size={size + 2} color="$uiNeutralPrimary" />
      </XStack>
      <SelectSheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={t("Select network")}
        value={value === undefined ? "" : String(value)}
        heightPercent={70}
        searchable
        options={[
          ...(all ? [{ label: t("All networks"), value: "" }] : []),
          ...chains.map((item) => ({
            icon: <ChainLogo chainId={item.id} size={24} />,
            label: item.name,
            value: String(item.id),
          })),
        ]}
        onChange={(selected) => {
          onChange(selected ? Number(selected) : undefined);
        }}
      />
    </>
  );
}
