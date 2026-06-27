import { alpha2ToAlpha3, getNames, registerLocale } from "i18n-iso-countries/index";
import en from "i18n-iso-countries/langs/en.json";

registerLocale(en);

const entries = Object.entries(getNames("en"))
  .flatMap(([alpha2, name]) => {
    const alpha3 = alpha2ToAlpha3(alpha2);
    return alpha3 ? [[alpha3, name] as const] : [];
  })
  .sort((a, b) => a[1].localeCompare(b[1]));

export const countryCodes = entries.map(([code]) => code);
export const countryLabels: Record<string, string> = Object.fromEntries(entries);
