import anyAscii from "any-ascii";

import { latin, transliterateAddress, transliterateName } from "./transliterate";

export { latin } from "./transliterate";

export type Name = { first: string; last: string };

export type Address = {
  city: string;
  postalCode: string;
  street1: string;
  street2?: null | string;
};

export function latinName(name: Name, country: string, document?: null | Partial<Record<keyof Name, null | string>>) {
  if (latin(name.first) && latin(name.last)) return;
  const first = latin(name.first) ? name.first : transliterateName(name.first, country, { document: document?.first });
  const last = latin(name.last)
    ? name.last
    : transliterateName(name.last, country, { document: document?.last, surname: true });
  if (first === undefined || last === undefined) return;
  return { first, last };
}

export function latinAddress<T extends Address>(address: T, country: string): T | undefined {
  const { city, street1, street2 } = address;
  const postalCode = normalizePostalCode(address.postalCode);
  if ([city, postalCode, street1, street2].every((value) => !value || latin(value))) return;
  const romanized = {
    city: transliterateAddress(city, country),
    street1: transliterateAddress(street1, country),
    street2: street2 && transliterateAddress(street2, country),
  };
  if (!romanized.city || !romanized.street1 || (street2 && !romanized.street2)) return;
  return { ...address, ...romanized, postalCode };
}

export function normalizePostalCode(code: string) {
  const ascii = code
    .normalize("NFKC")
    .replaceAll(/\p{Cf}/gu, "")
    .replaceAll(/\p{Pd}/gu, "-")
    .replaceAll(/\p{Nd}/gu, (digit) => {
      const value = anyAscii(digit);
      return /^\d$/.test(value) ? value : digit;
    })
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/ ?- ?/g, "-")
    .trim();
  return /^[\d\s]+$/.test(ascii) ? ascii.replaceAll(/\s/g, "") : ascii;
}
