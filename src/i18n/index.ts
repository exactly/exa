import * as locales from "date-fns/locale";
import i18next from "i18next";

import type { Locale } from "date-fns/locale";

const all = locales as Record<string, Locale>;

// eslint-disable-next-line import/prefer-default-export
export function date() {
  const resolved = i18next.resolvedLanguage ?? i18next.language;
  return all[resolved.replaceAll("-", "")] ?? all[resolved.split("-")[0] ?? "en"] ?? locales.enUS;
}
