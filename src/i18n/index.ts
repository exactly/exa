import { enUS, es, type Locale } from "date-fns/locale";

// eslint-disable-next-line import/prefer-default-export
export function date(language = "en") {
  return (
    (
      {
        es,
      } as Record<string, Locale>
    )[language] ?? enUS
  );
}
