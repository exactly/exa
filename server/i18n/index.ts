import { createInstance } from "i18next";

import en from "./en.json";
import es from "./es.json";

const instance = createInstance();
// eslint-disable-next-line @typescript-eslint/no-floating-promises -- initImmediate: false makes init synchronous
instance.init({
  initImmediate: false,
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  resources: { en: { translation: en }, es: { translation: es } },
});

export function formatAmount(value: number | string) {
  const n = typeof value === "string" ? Number(value) : value;
  const options =
    typeof value === "string"
      ? { minimumFractionDigits: 0, maximumFractionDigits: value.split(".")[1]?.length ?? 0 }
      : { maximumSignificantDigits: 6 };
  return { en: n.toLocaleString("en-US", options), es: n.toLocaleString("es-AR", options) };
}

export default function t(key: string, options?: Record<string, unknown>) {
  return {
    en: instance.t(key, { ...resolve(options, "en"), lng: "en" }),
    es: instance.t(key, { ...resolve(options, "es"), lng: "es" }),
  };
}

function resolve(options: Record<string, unknown> | undefined, lng: string) {
  if (!options) return {};
  return Object.fromEntries(
    Object.entries(options).map(([k, v]) => [
      k,
      v != null && typeof v === "object" && lng in v ? (v as Record<string, unknown>)[lng] : v,
    ]),
  );
}
