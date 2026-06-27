import { alpha3ToAlpha2 } from "i18n-iso-countries/index";
import { iso31662 } from "iso-3166";

const byAlpha2 = new Map<string, { label: string; value: string }[]>();
for (const { code, name, parent } of iso31662) {
  const list = byAlpha2.get(parent) ?? [];
  list.push({ value: code.slice(code.indexOf("-") + 1), label: name });
  byAlpha2.set(parent, list);
}
for (const list of byAlpha2.values()) list.sort((a, b) => a.label.localeCompare(b.label));

export default function subdivisions(alpha3: string): { label: string; value: string }[] {
  const alpha2 = alpha3ToAlpha2(alpha3);
  return alpha2 ? (byAlpha2.get(alpha2) ?? []) : [];
}
