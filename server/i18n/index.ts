import { captureException } from "@sentry/node";
import { createInstance } from "i18next";

import en from "./en.json";
import es from "./es.json";
import pt from "./pt.json";

const i18n = createInstance();
const resources = {
  en: { translation: en },
  es: { translation: es },
  pt: { translation: pt },
} as const;
type Language = keyof typeof resources;

i18n
  .init({
    initAsync: false,
    fallbackLng: "en",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    resources,
  })
  .catch(captureException);

export default function t(key: string, values?: Record<string, unknown>) {
  return {
    en: i18n.t(key, { ...resolve(values, "en"), lng: "en" }),
    es: i18n.t(key, { ...resolve(values, "es"), lng: "es" }),
    pt: i18n.t(key, { ...resolve(values, "pt"), lng: "pt" }),
  };
}

export function f(value: number | string, currency?: string) {
  const amount = typeof value === "string" ? Number(value) : value;
  const options = currency
    ? ({ style: "currency", currency } as const)
    : typeof value === "string"
      ? ({ maximumFractionDigits: 20 } as const)
      : ({ maximumSignificantDigits: 6 } as const);
  return Object.fromEntries(
    (Object.entries({ en: "en-US", es: "es-AR", pt: "pt-BR" } as const) as [Language, string][]).map(
      ([language, locale]) => [language, amount.toLocaleString(locale, options)],
    ),
  ) as Record<Language, string>;
}

function resolve(values: Record<string, unknown> | undefined, language: Language) {
  if (!values) return {};
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      !value || typeof value !== "object" || Array.isArray(value) || !(language in value)
        ? value
        : (value as Record<Language, unknown>)[language],
    ]),
  );
}
