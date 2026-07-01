import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, CircleHelp } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import {
  addressFields,
  Field,
  FieldInput,
  nest,
  optionsFor,
  routing,
  validator,
  type FieldConfig,
} from "./recipientForm";
import { isValidCurrency } from "../../utils/currencies";
import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, updateExternalAccount } from "../../utils/server";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import SelectSheet from "../shared/SelectSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function EditRecipient() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id, currency, provider } = useLocalSearchParams();
  const toast = useToastController();

  const [openSelect, setOpenSelect] = useState<string | undefined>();

  const currencyKey = typeof currency === "string" ? currency : "";
  const isUSD = currencyKey === "USD";

  const accountFields: FieldConfig[] = isUSD
    ? [
        {
          path: "account_routingNumber",
          label: "Routing number",
          placeholder: "Enter routing number",
          kind: "text",
          optional: true,
          validate: routing,
        },
        {
          path: "account_checkingOrSavings",
          label: "Account type",
          placeholder: "Select",
          kind: "select",
          optional: true,
          options: [
            { value: "checking", label: "Checking" },
            { value: "savings", label: "Savings" },
          ],
        },
      ]
    : [];
  const address = addressFields(isUSD ? { optionalGroup: true } : {});
  const fields = [...accountFields, ...address];
  const sections: { fields: FieldConfig[]; subtitle?: string; title?: string }[] = isUSD
    ? [
        { title: "Account details", fields: accountFields },
        { title: "Address", subtitle: "Leave blank to keep it, or enter the complete new address.", fields: address },
      ]
    : [{ fields: address }];
  const defaultValues: Record<string, string> = Object.fromEntries(fields.map((f) => [f.path, ""]));

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateExternalAccount>[1]) =>
      updateExternalAccount(typeof id === "string" ? id : "", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ramp", "external-accounts"] }).catch(reportError);
      toast.show(t("Contact updated"), {
        native: true,
        duration: 2000,
        burntOptions: { haptic: "success", preset: "done" },
      });
      router.replace({ pathname: "/send-funds/recipients", params: { currency, provider } });
    },
    onError: (error) => {
      const codeMessage = error instanceof APIError ? errorMessages[error.text] : undefined;
      if (!codeMessage) reportError(error);
      toast.show(codeMessage ? t(codeMessage) : t("Couldn't update the contact. Please try again."), {
        native: true,
        duration: 3000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      if (typeof currency !== "string") return;
      const stripped = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== ""));
      const payload = { currency, ...nest(stripped) };
      updateMutation.mutate(payload as Parameters<typeof updateExternalAccount>[1]);
    },
  });

  const currentCountry = useStore(form.store, ({ values }) => values.address_country ?? "");

  const canContinue = useStore(form.store, ({ values, fieldMeta }) => {
    if (fields.some((field) => fieldMeta[field.path]?.errors.some((error) => !!error))) return false;
    const filled = (path: string) => !!values[path]?.trim();
    if (isUSD) {
      const addressTouched = address.some((f) => filled(f.path));
      const addressComplete = [
        "address_streetLine1",
        "address_city",
        "address_state",
        "address_postalCode",
        "address_country",
      ].every((p) => filled(p));
      if (addressTouched && !addressComplete) return false;
      const accountTouched = filled("account_routingNumber") || filled("account_checkingOrSavings");
      return accountTouched || addressComplete;
    }
    return !fields.some((field) => !field.optional && !filled(field.path));
  });

  if (typeof currency !== "string" || !isValidCurrency(currency) || typeof id !== "string") {
    return <Redirect href="/send-funds" />;
  }

  const openField = openSelect ? fields.find((f) => f.path === openSelect) : undefined;

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s5" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds");
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Edit recipient")}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>

        <ScrollView flex={1}>
          <YStack flex={1} gap="$s5">
            <YStack gap="$s2">
              <Text title3 emphasized primary>
                {isUSD ? t("Update details") : t("Update address")}
              </Text>
              <Text footnote color="$uiNeutralPlaceholder">
                {isUSD
                  ? t("Update the account details and/or the address. At least one is required.")
                  : t("Enter the recipient's complete new address. This replaces the current one.")}
              </Text>
            </YStack>

            {sections.map((section) => (
              <YStack key={section.title ?? "address"} gap="$s4">
                {section.title && (
                  <YStack gap="$s1">
                    <Text emphasized footnote color="$uiNeutralSecondary">
                      {t(section.title)}
                    </Text>
                    {section.subtitle && (
                      <Text caption color="$uiNeutralPlaceholder">
                        {t(section.subtitle)}
                      </Text>
                    )}
                  </YStack>
                )}
                {section.fields.map((field) => (
                  <form.Field key={field.path} name={field.path} validators={{ onChange: validator(field) }}>
                    {({ state: { value, meta }, handleChange }) => (
                      <Field
                        label={t(field.label)}
                        optional={field.optional}
                        error={meta.isTouched && typeof meta.errors[0] === "string" ? meta.errors[0] : undefined}
                      >
                        <FieldInput
                          field={field}
                          value={value}
                          country={currentCountry}
                          onChange={handleChange}
                          onOpen={() => {
                            setOpenSelect(field.path);
                          }}
                        />
                      </Field>
                    )}
                  </form.Field>
                ))}
              </YStack>
            ))}
          </YStack>
        </ScrollView>

        <Button
          primary
          disabled={!canContinue || updateMutation.isPending}
          loading={updateMutation.isPending}
          onPress={() => {
            form.handleSubmit().catch(reportError);
          }}
        >
          <Button.Text>{t("Save changes")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </View>

      {openField &&
        (openField.kind === "country" || openField.kind === "select" || openField.kind === "subdivision") && (
          <SelectSheet
            open
            onClose={() => {
              setOpenSelect(undefined);
            }}
            title={openField.kind === "country" ? t("Select a country") : t(openField.label)}
            options={optionsFor(openField, currentCountry).map((o) => ({ label: t(o.label), value: o.value }))}
            value={form.getFieldValue(openField.path)}
            onChange={(newValue) => {
              form.setFieldValue(openField.path, newValue);
              if (openField.path === "address_country") form.resetField("address_state");
            }}
            heightPercent={openField.kind === "select" ? undefined : 70}
            searchable={openField.kind !== "select"}
          />
        )}
    </SafeView>
  );
}

const errorMessages: Record<string, string> = {
  "external account not found": "This contact no longer exists",
  "not approved": "Your KYC isn't approved for this currency",
  "not started": "Bridge setup incomplete",
  "no credential": "Session expired, please log in again",
};
