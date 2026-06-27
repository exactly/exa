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
  clabe,
  documentNumber,
  Field,
  FieldInput,
  isoCountry,
  name256,
  nest,
  optionsFor,
  routing,
  sortCode,
  text,
  ukAccount,
  validator,
  type FieldConfig,
} from "./recipientForm";
import { isValidCurrency } from "../../utils/currencies";
import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, createExternalAccount } from "../../utils/server";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import SelectSheet from "../shared/SelectSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function NewRecipient() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currency, provider } = useLocalSearchParams();
  const toast = useToastController();

  const [step, setStep] = useState(1);
  const [openSelect, setOpenSelect] = useState<string | undefined>();

  const currencyKey = typeof currency === "string" ? currency : "";
  const build = forms[currencyKey];

  const allFields = build ? supersetFields(build) : [];
  const defaultValues: Record<string, string> = Object.fromEntries(allFields.map((f) => [f.path, ""]));
  for (const field of allFields) {
    if (field.kind === "select" && (field.path === "accountOwnerType" || field.transient) && field.options?.[0]) {
      defaultValues[field.path] = field.options[0].value;
    }
  }

  const createMutation = useMutation({
    mutationFn: createExternalAccount,
    onSuccess: (newAccount) => {
      queryClient.invalidateQueries({ queryKey: ["ramp", "external-accounts"] }).catch(reportError);
      const usable = newAccount.addressValid !== false;
      if (!usable) {
        toast.show(t("Contact created, but its details need review before you can send."), {
          native: true,
          duration: 3000,
          burntOptions: { haptic: "warning", preset: "none" },
        });
        router.replace({ pathname: "/send-funds/recipients", params: { currency, provider } });
        return;
      }
      toast.show(t("Contact saved successfully"), {
        native: true,
        duration: 2000,
        burntOptions: { haptic: "success", preset: "done" },
      });
      router.push({
        pathname: "/send-funds/send-amount",
        params: { currency, provider, contactId: newAccount.id },
      });
    },
    onError: (error) => {
      const codeMessage = error instanceof APIError ? errorMessages[error.text] : undefined;
      if (codeMessage) {
        toast.show(t(codeMessage), {
          native: true,
          duration: 3000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        return;
      }
      reportError(error);
      toast.show(t("Couldn't create the account. Please try again."), {
        native: true,
        duration: 3000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      if (!build) return;
      const fields = build({ ownerType: value.accountOwnerType, method: value.method });
      const activePaths = new Set(fields.filter((f) => !f.transient).map((f) => f.path));
      const stripped = Object.fromEntries(Object.entries(value).filter(([k, v]) => v !== "" && activePaths.has(k)));
      const payload = { currency: currencyKey, ...nest(stripped) };
      createMutation.mutate(payload as Parameters<typeof createExternalAccount>[0]);
    },
  });

  const currentOwnerType = useStore(form.store, ({ values }) => values.accountOwnerType ?? "");
  const currentMethod = useStore(form.store, ({ values }) => values.method ?? "");
  const currentCountry = useStore(form.store, ({ values }) => values.address_country ?? "");

  const visibleFields = build ? build({ ownerType: currentOwnerType, method: currentMethod }) : [];
  const steps = getSteps(visibleFields);
  const currentStep = steps[step - 1];
  const totalSteps = steps.length;
  const isLastStep = step === totalSteps;

  const canContinue = useStore(form.store, ({ values, fieldMeta }) => {
    if (!currentStep) return false;
    return currentStep.fields.every((field) => {
      if (!field.optional && !values[field.path]) return false;
      const meta = fieldMeta[field.path];
      if (meta?.errors.some((error) => !!error)) return false;
      return true;
    });
  });

  if (typeof currency !== "string" || !isValidCurrency(currency) || !build || !currentStep) {
    return <Redirect href="/send-funds" />;
  }

  const openField = openSelect ? currentStep.fields.find((f) => f.path === openSelect) : undefined;

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s5" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (step > 1) {
                setStep(step - 1);
                return;
              }
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds");
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Send / {{currency}}", { currency })}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>

        {totalSteps > 1 && (
          <XStack gap="$s2" justifyContent="center">
            {steps.map((_, index) => (
              <View
                // eslint-disable-next-line @eslint-react/no-array-index-key -- stable order, fixed length
                key={index}
                width={48}
                height={4}
                borderRadius="$r1"
                backgroundColor={index + 1 <= step ? "$interactiveBaseBrandDefault" : "$borderNeutralSoft"}
              />
            ))}
          </XStack>
        )}

        <ScrollView flex={1}>
          <YStack flex={1} gap="$s5">
            <YStack gap="$s2">
              <Text title3 emphasized primary>
                {t(currentStep.title)}
              </Text>
              {currentStep.subtitle && (
                <Text footnote color="$uiNeutralPlaceholder">
                  {t(currentStep.subtitle)}
                </Text>
              )}
            </YStack>

            <YStack gap="$s4">
              {currentStep.fields.map((field) => (
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
          </YStack>
        </ScrollView>

        <Button
          primary
          disabled={!canContinue || createMutation.isPending}
          loading={createMutation.isPending}
          onPress={() => {
            if (!isLastStep) {
              setStep(step + 1);
              return;
            }
            form.handleSubmit().catch(reportError);
          }}
        >
          <Button.Text>{t("Continue")}</Button.Text>
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

type Step = { fields: FieldConfig[]; subtitle?: string; title: string };

const errorMessages: Record<string, string> = {
  "not approved": "Your KYC isn't approved for this currency",
  "not started": "Bridge setup incomplete",
  "no credential": "Session expired, please log in again",
  "external account already exists": "This bank account is already on your list",
  "invalid bank name": "Bank name not accepted, try a different one",
  "postal code required": "Postal code is required for this country",
};

const ownerName: FieldConfig = {
  path: "accountOwnerName",
  label: "Owner name",
  placeholder: "Enter recipient's full name",
  kind: "text",
  validate: name256,
};
const bankName: FieldConfig = {
  path: "bankName",
  label: "Bank name",
  placeholder: "Enter bank name",
  kind: "text",
  validate: name256,
};
const ownerTypeSelect: FieldConfig = {
  path: "accountOwnerType",
  label: "Owner type",
  placeholder: "Select",
  kind: "select",
  options: [
    { value: "individual", label: "Individual" },
    { value: "business", label: "Business" },
  ],
};
const businessName: FieldConfig = {
  path: "businessName",
  label: "Business name",
  placeholder: "Enter business name",
  kind: "text",
  validate: text,
};
const firstName: FieldConfig = {
  path: "firstName",
  label: "First name",
  placeholder: "Enter recipient's first name",
  kind: "text",
  validate: text,
};
const lastName: FieldConfig = {
  path: "lastName",
  label: "Last name",
  placeholder: "Enter recipient's last name",
  kind: "text",
  validate: text,
};

function nameFields(ownerType?: string): FieldConfig[] {
  return ownerType === "business" ? [businessName] : [firstName, lastName];
}

const forms: Record<string, (d: { method?: string; ownerType?: string }) => FieldConfig[]> = {
  USD: () => [
    ownerName,
    {
      path: "accountNumber",
      label: "Account number",
      placeholder: "Enter recipient's account number",
      kind: "text",
      validate: text,
    },
    {
      path: "routingNumber",
      label: "Routing number",
      placeholder: "Enter recipient's routing number",
      kind: "text",
      validate: routing,
    },
    {
      path: "checkingOrSavings",
      label: "Account type",
      placeholder: "Select",
      kind: "select",
      optional: true,
      options: [
        { value: "checking", label: "Checking" },
        { value: "savings", label: "Savings" },
      ],
    },
    bankName,
    ...addressFields({ requireStatePostal: true }),
  ],
  MXN: () => [
    ownerName,
    { path: "clabe", label: "CLABE", placeholder: "Enter recipient's 18-digit CLABE", kind: "text", validate: clabe },
    bankName,
    ...addressFields(),
  ],
  EUR: ({ ownerType }) => [
    ownerTypeSelect,
    ownerName,
    ...nameFields(ownerType),
    { path: "accountNumber", label: "IBAN", placeholder: "Enter recipient's IBAN", kind: "text", validate: text },
    { path: "bic", label: "BIC", placeholder: "Enter recipient's BIC", kind: "text", optional: true, validate: text },
    { path: "country", label: "Country", placeholder: "Select country", kind: "country", validate: isoCountry },
    bankName,
    ...addressFields(),
  ],
  GBP: ({ ownerType }) => [
    ownerTypeSelect,
    ownerName,
    ...nameFields(ownerType),
    {
      path: "accountNumber",
      label: "Account number",
      placeholder: "Enter recipient's 8-digit account number",
      kind: "text",
      validate: ukAccount,
    },
    {
      path: "sortCode",
      label: "Sort code",
      placeholder: "Enter recipient's 6-digit sort code",
      kind: "text",
      validate: sortCode,
    },
    bankName,
    ...addressFields(),
  ],
  BRL: ({ method }) => [
    ownerName,
    {
      path: "method",
      label: "Account type",
      placeholder: "Select",
      kind: "select",
      transient: true,
      options: [
        { value: "pixKey", label: "PIX Key" },
        { value: "brCode", label: "BR Code" },
      ],
    },
    method === "brCode"
      ? { path: "account_brCode", label: "BR Code", placeholder: "Paste BR Code", kind: "text", validate: text }
      : { path: "account_pixKey", label: "PIX key", placeholder: "Enter PIX key", kind: "text", validate: text },
    {
      path: "account_documentNumber",
      label: "Document number",
      placeholder: "Enter recipient's document number",
      kind: "text",
      optional: true,
      validate: documentNumber,
    },
    bankName,
    ...addressFields(),
  ],
};

function supersetFields(build: (d: { method?: string; ownerType?: string }) => FieldConfig[]): FieldConfig[] {
  const base = build({});
  const ownerTypes = base.find((f) => f.path === "accountOwnerType")?.options?.map((o) => o.value) ?? [""];
  const methods = base.find((f) => f.transient)?.options?.map((o) => o.value) ?? [""];
  const all = new Map<string, FieldConfig>();
  for (const ownerType of ownerTypes) {
    for (const method of methods) {
      for (const field of build({ ownerType, method })) if (!all.has(field.path)) all.set(field.path, field);
    }
  }
  return [...all.values()];
}

function getSteps(fields: FieldConfig[]): Step[] {
  if (fields.length <= 7) {
    return [{ title: "Add new recipient", subtitle: "Enter recipient's details", fields }];
  }
  const recipientFields = fields.filter((field) => isRecipientField(field));
  const accountFields = fields.filter((field) => !isRecipientField(field));
  return [
    { title: "Add new recipient", subtitle: "Enter recipient's details", fields: recipientFields },
    { title: "Recipient's account details", fields: accountFields },
  ];
}

function isRecipientField(field: FieldConfig): boolean {
  return field.path === "accountOwnerType" || field.path === "accountOwnerName" || field.path.startsWith("address_");
}
