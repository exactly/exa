import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, CircleHelp, Eye, EyeOff, Info, Landmark, Zap } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { getPixKeyType, isCNPJ, isCPF, PixKeyType } from "@pix.js/qrcode";
import { useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import {
  achReference,
  addressFields,
  brlReference,
  clabe,
  eurReference,
  Field,
  FieldInput,
  gbpReference,
  isoCountry,
  mxnReference,
  name256,
  nest,
  optionsFor,
  routing,
  sortCode,
  text,
  ukAccount,
  validator,
  wireReference,
  type FieldConfig,
} from "./recipientForm";
import Scanner from "./Scanner";
import TransferTypeSheet from "./TransferTypeSheet";
import { bridgeRails, isValidCurrency } from "../../utils/currencies";
import { presentArticle } from "../../utils/intercom";
import { isPixKey, parseBRCode, pixAccount, taxDocument } from "../../utils/pix";
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
  const { currency, provider, scan } = useLocalSearchParams();
  const toast = useToastController();

  const [step, setStep] = useState(1);
  const [openSelect, setOpenSelect] = useState<string | undefined>();
  const [openInfo, setOpenInfo] = useState(false);
  const [scanning, setScanning] = useState(scan === "1");
  const [amount, setAmount] = useState<string>();

  const currencyKey = typeof currency === "string" ? currency : "";
  const build = forms[currencyKey];

  const allFields = build ? supersetFields(build) : [];
  const variantField = allFields.find((field) => field.variant);
  const defaultValues: Record<string, string> = Object.fromEntries(allFields.map((f) => [f.path, ""]));
  for (const field of allFields) {
    if (field.kind === "select" && (field.path === "accountOwnerType" || field.variant) && field.options?.[0]) {
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
          duration: 3000,
          burntOptions: { haptic: "warning", preset: "none" },
        });
        router.replace({ pathname: "/send-funds/recipients", params: { currency, provider } });
        return;
      }
      toast.show(t("Contact saved successfully"), {
        duration: 2000,
        burntOptions: { haptic: "success", preset: "done" },
      });
      router.push({
        pathname: "/send-funds/send-amount",
        params: { currency, provider, contactId: newAccount.id, ...(amount && { amount }) },
      });
    },
    onError: (error) => {
      const codeMessage = error instanceof APIError ? errorMessages[error.text] : undefined;
      if (codeMessage) {
        toast.show(t(codeMessage), {
          duration: 3000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        return;
      }
      reportError(error);
      toast.show(t("Couldn't create the account. Please try again."), {
        duration: 3000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      if (!build) return;
      const fields = build({
        ownerType: value.accountOwnerType,
        variant: variantField ? value[variantField.path] : undefined,
      });
      const activePaths = new Set(fields.filter((f) => !f.transient).map((f) => f.path));
      const stripped = Object.fromEntries(Object.entries(value).filter(([k, v]) => v !== "" && activePaths.has(k)));
      if (stripped.account_pixKey && parseBRCode(stripped.account_pixKey)) {
        stripped.account_brCode = stripped.account_pixKey;
        delete stripped.account_pixKey;
      } else if (stripped.account_pixKey && (isCPF(stripped.account_pixKey) || isCNPJ(stripped.account_pixKey))) {
        stripped.account_pixKey = stripped.account_pixKey.replaceAll(/\D/g, "");
      }
      if (stripped.account_documentNumber) {
        stripped.account_documentNumber = stripped.account_documentNumber.replaceAll(/\D/g, "");
      }
      const payload = { currency: currencyKey, ...nest(stripped) };
      createMutation.mutate(payload as Parameters<typeof createExternalAccount>[0]);
    },
  });

  const currentOwnerType = useStore(form.store, ({ values }) => values.accountOwnerType ?? "");
  const currentVariant = useStore(form.store, ({ values }) => (variantField ? (values[variantField.path] ?? "") : ""));
  const currentCountry = useStore(form.store, ({ values }) => values.address_country ?? "");

  const visibleFields = build ? build({ ownerType: currentOwnerType, variant: currentVariant }) : [];
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

  function fill(path: string, value?: string) {
    if (!value) return false;
    const field = allFields.find((f) => f.path === path);
    if (!field || validator(field)({ value })) return false;
    form.setFieldValue(path, value);
    return true;
  }

  if (scanning) {
    return (
      <Scanner
        onClose={() => {
          if (router.canGoBack()) router.back();
          else setScanning(false);
        }}
        onScan={(data) => {
          const code = parseBRCode(data);
          if (!code) {
            toast.show(t("Couldn't read this QR code. Make sure it's a PIX code."), {
              duration: 3000,
              burntOptions: { haptic: "error", preset: "error" },
            });
            return false;
          }
          if (!(code.type === "static" && fill("account_pixKey", code.key))) fill("account_pixKey", code.brCode);
          for (const [path, value] of Object.entries({
            accountOwnerName: code.ownerName,
            address_city: code.city,
            address_country: code.country,
            address_postalCode: code.postalCode,
            ...(code.type === "static" && { account_documentNumber: code.key, reference: code.txId }),
          })) {
            fill(path, value);
          }
          setAmount(code.type === "static" && code.value ? code.value.toFixed(2) : undefined);
          setScanning(false);
          return true;
        }}
      />
    );
  }

  const openField = openSelect ? currentStep.fields.find((f) => f.path === openSelect) : undefined;
  const info = currentStep.fields.some((field) => field.info);

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

        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <YStack flex={1} gap="$s5">
            <YStack gap="$s2">
              <XStack gap="$s2" alignItems="center">
                <Text title3 emphasized primary>
                  {t(currentStep.title)}
                </Text>
                {info && (
                  <IconButton
                    icon={Info}
                    size={20}
                    color="$interactiveBaseBrandDefault"
                    aria-label={t("More info")}
                    onPress={() => {
                      setOpenInfo(true);
                    }}
                  />
                )}
              </XStack>
              {currentStep.subtitle && (
                <Text footnote color="$uiNeutralPlaceholder">
                  {t(currentStep.subtitle)}
                </Text>
              )}
            </YStack>

            <YStack gap="$s4">
              {currentStep.fields.map((field) => (
                <form.Field key={field.path} name={field.path} validators={{ onChange: validator(field) }}>
                  {({ state: { value, meta }, handleChange }) => {
                    function change(next: string) {
                      handleChange(next);
                      if (next === value) return;
                      if (field.kind === "option" || field.path === "account_pixKey") form.resetField("reference");
                      if (field.path === "account_pixKey") setAmount(undefined);
                    }
                    const code = field.path === "account_pixKey" ? parseBRCode(value) : undefined;
                    const input = code ? (
                      <BRCodeField value={value} name={code.ownerName} />
                    ) : (
                      <FieldInput
                        field={field}
                        value={value}
                        country={currentCountry}
                        onChange={change}
                        onOpen={() => {
                          setOpenSelect(field.path);
                        }}
                      />
                    );
                    return field.kind === "option" ? (
                      input
                    ) : (
                      <Field
                        label={t(field.label)}
                        optional={field.optional}
                        error={meta.isTouched && typeof meta.errors[0] === "string" ? meta.errors[0] : undefined}
                      >
                        {input}
                        {field.path === "account_pixKey" && <AccountHint value={value} code={code} />}
                      </Field>
                    );
                  }}
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

      {info && (
        <TransferTypeSheet
          open={openInfo}
          onClose={() => {
            setOpenInfo(false);
          }}
        />
      )}
    </SafeView>
  );
}

type Step = { fields: FieldConfig[]; subtitle?: string; title: string };

const pixKeyLabels: Record<PixKeyType, string> = {
  [PixKeyType.Cpf]: "CPF",
  [PixKeyType.Cnpj]: "CNPJ",
  [PixKeyType.Email]: "Email",
  [PixKeyType.Phone]: "Phone number",
  [PixKeyType.Evp]: "Random key",
};

const errorMessages: Record<string, string> = {
  "not approved": "Your KYC isn't approved for this currency",
  "not started": "Bridge setup incomplete",
  "no credential": "Session expired, please log in again",
  "external account already exists": "This bank account is already on your list",
  "transfer not found": "This contact needs to be recreated before you can send",
  "invalid bank name": "Bank name not accepted, try a different one",
  "postal code required": "Postal code is required for this country",
};

const ownerName: FieldConfig = {
  path: "accountOwnerName",
  label: "Beneficiary name",
  placeholder: "Enter beneficiary's full name",
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
  label: "Beneficiary type",
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
  placeholder: "Enter beneficiary's first name",
  kind: "text",
  validate: text,
};
const lastName: FieldConfig = {
  path: "lastName",
  label: "Last name",
  placeholder: "Enter beneficiary's last name",
  kind: "text",
  validate: text,
};

function nameFields(ownerType?: string): FieldConfig[] {
  return ownerType === "business" ? [businessName] : [firstName, lastName];
}

function AccountHint({ value, code }: { code: ReturnType<typeof parseBRCode>; value: string }) {
  const { t } = useTranslation();
  const trimmed = value.trim();
  if (!code) {
    if (!isPixKey(trimmed)) return null;
    return (
      <Text footnote color="$uiNeutralPlaceholder">
        {t("PIX key · {{type}}", { type: t(pixKeyLabels[getPixKeyType(trimmed)]) })}
      </Text>
    );
  }
  if (code.type !== "dynamic" || !code.oneTime) return null;
  return (
    <YStack gap="$s1">
      <Text footnote color="$uiWarningSecondary">
        {t("One-time charge")}
      </Text>
      <Text caption color="$uiNeutralPlaceholder">
        {t("The saved contact may stop working once it's paid.")}
      </Text>
    </YStack>
  );
}

function BRCodeField({ value, name }: { name?: string; value: string }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  return (
    <XStack
      backgroundColor="$backgroundSoft"
      borderRadius="$r3"
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      alignItems="center"
      overflow="hidden"
    >
      {revealed ? (
        <Text flex={1} padding="$s3" caption secondary userSelect="text">
          {value}
        </Text>
      ) : (
        <Text flex={1} padding="$s3" numberOfLines={1}>
          {name ? t("BR Code · {{name}}", { name }) : t("BR Code")}
        </Text>
      )}
      <View
        backgroundColor="$interactiveBaseBrandSoftDefault"
        padding="$s3_5"
        alignSelf="stretch"
        justifyContent="center"
        alignItems="center"
        cursor="pointer"
        aria-label={t(revealed ? "Hide BR Code" : "Show BR Code")}
        onPress={() => {
          setRevealed(!revealed);
        }}
      >
        {revealed ? <EyeOff size={24} color="$iconBrandDefault" /> : <Eye size={24} color="$iconBrandDefault" />}
      </View>
    </XStack>
  );
}

function referenceField(validate: FieldConfig["validate"]): FieldConfig {
  return {
    path: "reference",
    label: "Reference",
    placeholder: "Shown on the beneficiary's statement",
    kind: "text",
    optional: true,
    validate,
  };
}

const forms: Record<string, (d: { ownerType?: string; variant?: string }) => FieldConfig[]> = {
  USD: ({ variant }) => [
    {
      path: "rail",
      label: "Transfer type",
      placeholder: "Select",
      kind: "option",
      variant: true,
      info: true,
      options: [
        { value: "ach", icon: Landmark, ...bridgeRails.ach },
        { value: "wire", icon: Zap, ...bridgeRails.wire },
      ],
    },
    ownerName,
    {
      path: "accountNumber",
      label: "Account number",
      placeholder: "Enter beneficiary's account number",
      kind: "text",
      validate: text,
    },
    {
      path: "routingNumber",
      label: "Routing number",
      placeholder: "Enter beneficiary's routing number",
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
    variant === "wire"
      ? { ...referenceField(wireReference), multiline: true, optional: false }
      : referenceField(achReference),
  ],
  MXN: () => [
    ownerName,
    { path: "clabe", label: "CLABE", placeholder: "Enter beneficiary's 18-digit CLABE", kind: "text", validate: clabe },
    bankName,
    ...addressFields(),
    referenceField(mxnReference),
  ],
  EUR: ({ ownerType }) => [
    ownerTypeSelect,
    ownerName,
    ...nameFields(ownerType),
    { path: "accountNumber", label: "IBAN", placeholder: "Enter beneficiary's IBAN", kind: "text", validate: text },
    { path: "bic", label: "BIC", placeholder: "Enter beneficiary's BIC", kind: "text", optional: true, validate: text },
    { path: "country", label: "Country", placeholder: "Select country", kind: "country", validate: isoCountry },
    bankName,
    ...addressFields(),
    referenceField(eurReference),
  ],
  GBP: ({ ownerType }) => [
    ownerTypeSelect,
    ownerName,
    ...nameFields(ownerType),
    {
      path: "accountNumber",
      label: "Account number",
      placeholder: "Enter beneficiary's 8-digit account number",
      kind: "text",
      validate: ukAccount,
    },
    {
      path: "sortCode",
      label: "Sort code",
      placeholder: "Enter beneficiary's 6-digit sort code",
      kind: "text",
      validate: sortCode,
    },
    bankName,
    ...addressFields(),
    referenceField(gbpReference),
  ],
  BRL: () => [
    ownerName,
    {
      path: "account_pixKey",
      label: "PIX key or BR Code",
      placeholder: "Enter a key or paste a BR Code",
      kind: "text",
      validate: pixAccount,
    },
    {
      path: "account_documentNumber",
      label: "Document number",
      placeholder: "Enter beneficiary's document number",
      kind: "text",
      optional: true,
      validate: taxDocument,
    },
    bankName,
    ...addressFields(),
    referenceField(brlReference),
  ],
};

function supersetFields(build: (d: { ownerType?: string; variant?: string }) => FieldConfig[]): FieldConfig[] {
  const base = build({});
  const ownerTypes = base.find((f) => f.path === "accountOwnerType")?.options?.map((o) => o.value) ?? [""];
  const variants = base.find((f) => f.variant)?.options?.map((o) => o.value) ?? [""];
  const all = new Map<string, FieldConfig>();
  for (const ownerType of ownerTypes) {
    for (const variant of variants) {
      for (const field of build({ ownerType, variant })) if (!all.has(field.path)) all.set(field.path, field);
    }
  }
  return [...all.values()];
}

function getSteps(fields: FieldConfig[]): Step[] {
  const optionSteps = fields
    .filter((field) => field.kind === "option")
    .map((field) => ({ title: field.label, fields: [field] }));
  const rest = fields.filter((field) => field.kind !== "option");
  if (rest.length <= 7) {
    return [...optionSteps, { title: "Add new beneficiary", subtitle: "Enter beneficiary's details", fields: rest }];
  }
  return [
    ...optionSteps,
    {
      title: "Add new beneficiary",
      subtitle: "Enter beneficiary's details",
      fields: rest.filter((field) => isRecipientField(field)),
    },
    { title: "Beneficiary's account details", fields: rest.filter((field) => !isRecipientField(field)) },
  ];
}

function isRecipientField(field: FieldConfig): boolean {
  return field.path === "accountOwnerType" || field.path === "accountOwnerName" || field.path.startsWith("address_");
}
