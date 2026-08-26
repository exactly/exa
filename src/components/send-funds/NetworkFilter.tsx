import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { ChevronDown } from "@tamagui/lucide-icons";
import { XStack } from "tamagui";

import ChainLogo from "../shared/ChainLogo";
import SelectSheet from "../shared/SelectSheet";
import View from "../shared/View";

export default function NetworkFilter({
  chains,
  value,
  onChange,
}: {
  chains: { id: number; name: string }[];
  onChange: (chainId: number | undefined) => void;
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
        onPress={() => {
          setOpen(true);
        }}
      >
        {value === undefined ? (
          <View width={18} height={18} flexDirection="row" flexWrap="wrap" gap={2}>
            {chains.slice(0, 4).map((item) => (
              <ChainLogo key={item.id} chainId={item.id} size={8} />
            ))}
          </View>
        ) : (
          <ChainLogo chainId={value} size={18} />
        )}
        <ChevronDown size={20} color="$uiNeutralPrimary" />
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
          { label: t("All networks"), value: "" },
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
