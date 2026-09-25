import React, { type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";

import { ChevronDown } from "@tamagui/lucide-icons-2";
import { XStack } from "tamagui";

import ChainLogo from "./ChainLogo";
import SelectSheet from "./SelectSheet";
import View from "./View";

export default function NetworkFilter({
  chains,
  value,
  open,
  onChange,
  onOpenChange,
  all = true,
  icon,
  size = 18,
  ...properties
}: Omit<ComponentPropsWithoutRef<typeof XStack>, "onChange"> & {
  all?: boolean;
  chains: { disabled?: boolean; id: number; name: string }[];
  icon?: React.ReactNode;
  onChange: (chainId: number | undefined) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: number;
  value?: number;
}) {
  const { t } = useTranslation();
  const selectable = chains.filter((item) => !item.disabled);
  const sole = selectable.length === 1 ? selectable[0] : undefined;
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
          onOpenChange(true);
        }}
      >
        {icon ??
          (value === undefined && !sole ? (
            <Mosaic chains={selectable} size={size} />
          ) : (
            <ChainLogo chainId={value ?? sole?.id} size={size} />
          ))}
        <ChevronDown size={size + 2} color="$uiNeutralPrimary" />
      </XStack>
      <SelectSheet
        open={open}
        onClose={() => {
          onOpenChange(false);
        }}
        title={t("Select network")}
        value={String(value ?? sole?.id ?? "")}
        heightPercent={70}
        searchable
        options={[
          ...(all
            ? [
                {
                  disabled: !!sole,
                  icon: <Mosaic chains={selectable} size={24} />,
                  label: t("All networks"),
                  value: "",
                },
              ]
            : []),
          ...chains.map((item) => ({
            disabled: item.disabled,
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

function Mosaic({ chains, size }: { chains: { id: number }[]; size: number }) {
  return (
    <View
      width={size}
      height={size}
      flexDirection="row"
      flexWrap="wrap"
      justifyContent="center"
      alignContent="center"
      gap={2}
    >
      {chains.slice(0, 4).map((item) => (
        <ChainLogo key={item.id} chainId={item.id} size={size / 2 - 1} />
      ))}
    </View>
  );
}
