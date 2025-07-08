import { getLocales } from "expo-localization";

export default {
  type: "languageDetector",
  async: true,
  detect: (callback: (locale: string) => void): string | undefined => {
    const locales = getLocales();
    const locale = locales[0]?.languageCode;
    if (locale) callback(locale);
    return "en-US";
  },
} as const;
