import React, { type ComponentProps } from "react";

import { useLocales } from "expo-localization";

import Input from "./Input";

export default function AmountInput({
  decimals,
  onChangeText,
  value,
  ...properties
}: Omit<ComponentProps<typeof Input>, "inputMode" | "keyboardType" | "onChangeText" | "value"> & {
  decimals: number;
  onChangeText: (value: string) => void;
  value: string;
}) {
  const separator = useLocales()[0].decimalSeparator ?? ".";
  return (
    <Input
      {...properties}
      inputMode="decimal"
      value={value.replace(".", separator)}
      onChangeText={(text) => {
        const next = text.trim().replaceAll(separator, ".").replaceAll(",", ".");
        if (!/^\d*(?:\.\d*)?$/.test(next)) return;
        const fraction = next.split(".")[1]?.length ?? 0;
        if (fraction > decimals && fraction > (value.split(".")[1]?.length ?? 0)) return;
        onChangeText(next === "." ? "0." : next);
      }}
    />
  );
}
