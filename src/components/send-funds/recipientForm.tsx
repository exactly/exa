import type { ComponentPropsWithoutRef, ComponentType } from "react";
import React from "react";
import { useTranslation } from "react-i18next";

import { getStringAsync } from "expo-clipboard";

import type { ArrowRight } from "@tamagui/lucide-icons";
import { ChevronDown, ClipboardPaste } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { check, length, maxLength, minLength, pipe, regex, safeParse, string } from "valibot";

import { countryCodes, countryLabels } from "../../utils/countries";
import reportError from "../../utils/reportError";
import subdivisions from "../../utils/subdivisions";
import Input from "../shared/Input";
import Text from "../shared/Text";
import View from "../shared/View";

import type { GenericSchema } from "valibot";

export type FieldConfig = {
  info?: boolean;
  kind: "country" | "option" | "select" | "subdivision" | "text";
  label: string;
  multiline?: boolean;
  optional?: boolean;
  options?: {
    fee?: string;
    icon?: ComponentType<ComponentPropsWithoutRef<typeof ArrowRight>>;
    label: string;
    time?: string;
    value: string;
  }[];
  path: string;
  placeholder: string;
  transient?: boolean;
  validate?: GenericSchema<string>;
  variant?: boolean;
};

export const text = pipe(string(), minLength(1, "Required"));
export const name256 = pipe(string(), minLength(1, "Required"), maxLength(256, "Too long"));
export const isoCountry = pipe(string(), length(3, "Invalid country code"));
export const stateCode = pipe(string(), minLength(1, "Required"), maxLength(3, "Use a 1-3 letter state code"));
export const street = pipe(
  string(),
  minLength(4, "Must be at least 4 characters"),
  maxLength(35, "Must be 35 characters or less"),
);
export const line2 = pipe(string(), maxLength(35, "Must be 35 characters or less"));
export const routing = pipe(string(), regex(/^\d{9}$/, "Must be 9 numbers"));
export const clabe = pipe(string(), regex(/^\d{18}$/, "Must be 18 numbers"));
export const ukAccount = pipe(string(), regex(/^\d{8}$/, "Must be 8 numbers"));
export const sortCode = pipe(string(), regex(/^\d{6}$/, "Must be 6 numbers"));
export const documentNumber = pipe(string(), regex(/^\d+$/, "Numbers only"));
export const achReference = pipe(
  string(),
  maxLength(10, "Must be 10 characters or less"),
  regex(/^[\dA-Z ]+$/i, "Letters, numbers and spaces only"),
);
export const wireReference = pipe(
  string(),
  minLength(1, "Required"),
  check(
    (value) => value.split("\n").every((line, index) => index < 4 && line.length <= 35),
    "Up to 4 lines of 35 characters",
  ),
);
export const eurReference = pipe(
  string(),
  minLength(6, "Must be 6 to 140 characters"),
  maxLength(140, "Must be 6 to 140 characters"),
  regex(/^[\dA-Z &./-]+$/i, "Letters, numbers, spaces and & - . / only"),
);
export const gbpReference = pipe(string(), maxLength(18, "Must be 18 characters or less"));
export const mxnReference = pipe(
  string(),
  maxLength(40, "Must be 40 characters or less"),
  regex(/^[\dA-Z ]+$/i, "Letters, numbers and spaces only"),
);
export const brlReference = pipe(string(), maxLength(100, "Must be 100 characters or less"));

export const countryOptions = countryCodes.map((code) => ({ value: code, label: countryLabels[code] ?? code }));

export function addressFields({
  optionalGroup = false,
  requireStatePostal = false,
}: { optionalGroup?: boolean; requireStatePostal?: boolean } = {}): FieldConfig[] {
  return [
    {
      path: "address_streetLine1",
      label: "Address",
      placeholder: "Enter address",
      kind: "text",
      optional: optionalGroup,
      validate: street,
    },
    {
      path: "address_streetLine2",
      label: "Address line 2",
      placeholder: "Optional second line",
      kind: "text",
      optional: true,
      validate: line2,
    },
    {
      path: "address_city",
      label: "City",
      placeholder: "Enter city",
      kind: "text",
      optional: optionalGroup,
      validate: text,
    },
    {
      path: "address_country",
      label: "Country",
      placeholder: "Select country",
      kind: "country",
      optional: optionalGroup,
      validate: isoCountry,
    },
    {
      path: "address_state",
      label: "State",
      placeholder: "1-3 letter code",
      kind: "subdivision",
      optional: optionalGroup || !requireStatePostal,
      validate: stateCode,
    },
    {
      path: "address_postalCode",
      label: "Zip code",
      placeholder: "Enter zip code",
      kind: "text",
      optional: optionalGroup || !requireStatePostal,
      validate: text,
    },
  ];
}

export function validator(field: FieldConfig) {
  return ({ value }: { value: string }) => {
    if (!field.validate) return;
    const trimmed = value.trim();
    if (field.optional && trimmed === "") return;
    const result = safeParse(field.validate, trimmed);
    return result.success ? undefined : result.issues[0].message;
  };
}

export function nest(flat: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(flat)) {
    const value = rawValue.trim();
    if (value === "") continue;
    const separator = key.indexOf("_");
    if (separator === -1) {
      result[key] = value;
      continue;
    }
    const parent = key.slice(0, separator);
    const child = key.slice(separator + 1);
    if (typeof result[parent] !== "object" || result[parent] === null) result[parent] = {};
    (result[parent] as Record<string, string>)[child] = value;
  }
  return result;
}

export function labelFor(field: FieldConfig, value: string): string {
  if (field.kind === "country") return countryLabels[value] ?? value;
  return field.options?.find((o) => o.value === value)?.label ?? value;
}

export function optionsFor(field: FieldConfig, country: string): { label: string; value: string }[] {
  if (field.kind === "country") return countryOptions;
  if (field.kind === "subdivision") return subdivisions(country);
  return field.options ?? [];
}

export function Field({
  label,
  optional,
  error,
  children,
}: {
  children: React.ReactNode;
  error?: string;
  label: string;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <YStack gap="$s2">
      <XStack gap="$s2" alignItems="baseline">
        <Text footnote emphasized primary>
          {label}
        </Text>
        {optional && (
          <Text footnote color="$uiNeutralPlaceholder">
            ({t("optional")})
          </Text>
        )}
      </XStack>
      {children}
      {error && (
        <Text footnote color="$uiErrorSecondary">
          {t(error)}
        </Text>
      )}
    </YStack>
  );
}

export function TextField({
  placeholder,
  value,
  multiline,
  onChangeText,
}: {
  multiline?: boolean;
  onChangeText: (text: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <XStack
      backgroundColor="$backgroundSoft"
      borderRadius="$r3"
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      alignItems="center"
      overflow="hidden"
    >
      <Input
        flex={1}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        borderWidth={0}
        backgroundColor="transparent"
        multiline={multiline}
        numberOfLines={multiline ? 4 : undefined}
        minHeight={multiline ? 96 : undefined}
      />
      <View
        backgroundColor="$interactiveBaseBrandSoftDefault"
        padding="$s3_5"
        alignSelf="stretch"
        justifyContent="center"
        alignItems="center"
        cursor="pointer"
        onPress={() => {
          getStringAsync()
            .then((clip) => {
              if (clip) onChangeText(clip.trim());
            })
            .catch(reportError);
        }}
      >
        <ClipboardPaste size={24} color="$iconBrandDefault" />
      </View>
    </XStack>
  );
}

export function SelectField({
  placeholder,
  value,
  displayValue,
  onPress,
  disabled,
}: {
  disabled?: boolean;
  displayValue?: string;
  onPress: () => void;
  placeholder: string;
  value: string;
}) {
  return (
    <XStack
      backgroundColor="$backgroundSoft"
      borderRadius="$r3"
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      alignItems="center"
      cursor={disabled ? "default" : "pointer"}
      opacity={disabled ? 0.5 : 1}
      overflow="hidden"
      onPress={disabled ? undefined : onPress}
      role="button"
      aria-disabled={disabled}
    >
      <Text flex={1} padding="$s3" color={value ? "$uiNeutralPrimary" : "$uiNeutralPlaceholder"}>
        {(displayValue ?? value) || placeholder}
      </Text>
      <View
        backgroundColor="$interactiveBaseBrandSoftDefault"
        padding="$s3_5"
        alignSelf="stretch"
        justifyContent="center"
        alignItems="center"
      >
        <ChevronDown size={24} color="$iconBrandDefault" />
      </View>
    </XStack>
  );
}

export function OptionField({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  onChange: (value: string) => void;
  options: NonNullable<FieldConfig["options"]>;
  value: string;
}) {
  const { t } = useTranslation();
  return (
    <YStack gap="$s4" role="radiogroup" aria-label={t(label)}>
      {options.map(({ value: option, label: name, icon: Icon, time, fee }) => {
        const selected = value === option;
        return (
          <XStack
            key={option}
            gap="$s3_5"
            alignItems="center"
            padding="$s4_5"
            backgroundColor="$backgroundSoft"
            borderRadius="$r5"
            borderWidth={1}
            borderColor={selected ? "$borderBrandStrong" : "$borderNeutralSoft"}
            cursor="pointer"
            pressStyle={{ opacity: 0.7 }}
            role="radio"
            aria-checked={selected}
            onPress={() => {
              onChange(option);
            }}
          >
            <YStack flex={1} gap="$s3_5">
              <XStack gap="$s3" alignItems="center">
                {Icon && <Icon size={24} color="$iconBrandDefault" />}
                <Text emphasized headline primary>
                  {t(name)}
                </Text>
              </XStack>
              <XStack gap="$s6">
                {time && (
                  <OptionDetail label={t("Estimated time")}>
                    <Text footnote color="$uiNeutralSecondary">
                      {t(time)}
                    </Text>
                  </OptionDetail>
                )}
                {fee && (
                  <OptionDetail label={t("Fees")}>
                    <XStack gap="$s2" alignItems="center">
                      <Text footnote strikeThrough color="$uiNeutralSecondary">
                        {fee}
                      </Text>
                      <Text footnote emphasized color="$uiSuccessSecondary">
                        {t("Free")}
                      </Text>
                    </XStack>
                  </OptionDetail>
                )}
              </XStack>
            </YStack>
            <View
              width={24}
              height={24}
              borderRadius="$r_0"
              borderWidth={1}
              borderColor={selected ? "$borderBrandStrong" : "$borderNeutralSoft"}
              alignItems="center"
              justifyContent="center"
            >
              {selected && (
                <View width={12} height={12} borderRadius="$r_0" backgroundColor="$interactiveBaseBrandDefault" />
              )}
            </View>
          </XStack>
        );
      })}
    </YStack>
  );
}

export function FieldInput({
  field,
  value,
  country,
  onChange,
  onOpen,
}: {
  country: string;
  field: FieldConfig;
  onChange: (text: string) => void;
  onOpen: () => void;
  value: string;
}) {
  const { t } = useTranslation();
  if (field.kind === "option") {
    return <OptionField label={field.label} options={field.options ?? []} value={value} onChange={onChange} />;
  }
  if (field.kind === "text") {
    return (
      <TextField placeholder={t(field.placeholder)} value={value} multiline={field.multiline} onChangeText={onChange} />
    );
  }
  if (field.kind === "subdivision") {
    if (!country) return <SelectField placeholder={t("Select a country first")} value="" disabled onPress={onOpen} />;
    const subs = subdivisions(country);
    if (subs.length === 0) {
      return <TextField placeholder={t(field.placeholder)} value={value} onChangeText={onChange} />;
    }
    return (
      <SelectField
        placeholder={t("Select state")}
        value={value}
        displayValue={subs.find((option) => option.value === value)?.label}
        onPress={onOpen}
      />
    );
  }
  return (
    <SelectField
      placeholder={t(field.placeholder)}
      value={value}
      displayValue={value ? t(labelFor(field, value)) : undefined}
      onPress={onOpen}
    />
  );
}

function OptionDetail({ label, children }: { children: React.ReactNode; label: string }) {
  return (
    <YStack gap="$s1">
      <Text caption2 color="$uiNeutralPlaceholder">
        {label}
      </Text>
      {children}
    </YStack>
  );
}
