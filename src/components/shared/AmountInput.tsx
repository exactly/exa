import React, { useRef, type ComponentProps } from "react";
import { Platform } from "react-native";

import { useLocales } from "expo-localization";

import Input from "./Input";

export default function AmountInput({
  clearOnType = false,
  decimals,
  onChangeText,
  value,
  ...properties
}: Omit<ComponentProps<typeof Input>, "inputMode" | "keyboardType" | "onChange" | "onChangeText" | "value"> & {
  clearOnType?: boolean;
  decimals: number;
  onChangeText: (value: string) => void;
  value: string;
}) {
  const separator = useLocales()[0].decimalSeparator ?? ".";
  const endRef = useRef(value.length);
  return (
    <Input
      {...properties}
      inputMode="decimal"
      value={value.replace(".", separator)}
      onSelectionChange={({ nativeEvent: { selection } }) => {
        endRef.current = selection.end;
      }}
      onChange={({ target }) => {
        const typed = target.value.trim().replaceAll(separator, ".").replaceAll(",", ".");
        let head = 0;
        while (head < value.length && typed[head] === value[head]) head += 1;
        const append = clearOnType && typed.length > value.length && typed.endsWith(value.slice(head));
        const previous = append ? "" : value;
        const raw = append ? typed.slice(head, typed.length - value.length + head) : typed;
        const next =
          append ||
          (!value.startsWith(raw) &&
            (Platform.OS === "web" ? target.selectionEnd === target.value.length : endRef.current >= value.length))
            ? raw.replace(/^0+(?=\d)/, "")
            : raw;
        if (!/^\d*(?:\.\d*)?$/.test(next)) return;
        const fraction = next.split(".")[1]?.length ?? 0;
        if (fraction > decimals && fraction > (previous.split(".")[1]?.length ?? 0)) return;
        onChangeText(next === "." ? "0." : next);
      }}
    />
  );
}
