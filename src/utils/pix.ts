import {
  isCNPJ,
  isCPF,
  isDynamicPix,
  isStaticPix,
  keyDetector,
  parseDynamicPix,
  parseStaticPix,
  PointOfInitiationMethod,
} from "@pix.js/qrcode";
import { alpha2ToAlpha3 } from "i18n-iso-countries/index";
import { check, pipe, string } from "valibot";

export function parseBRCode(payload: string) {
  const code = payload.trim();
  if (isStaticPix(code)) {
    let parsed: Static;
    try {
      parsed = parseStaticPix(code) as Static;
    } catch {
      return;
    }
    const key = parsed.merchantAccountInfo?.key;
    if (!key || !parsed.merchantName) return;
    return {
      type: "static",
      brCode: code,
      key,
      ownerName: parsed.merchantName,
      city: parsed.merchantCity,
      country: parsed.countryCode && alpha2ToAlpha3(parsed.countryCode),
      postalCode: parsed.postalCode,
      value: parsed.value,
      txId: parsed.additionalData?.txId === "***" ? undefined : parsed.additionalData?.txId,
    } as const;
  }
  if (isDynamicPix(code)) {
    let parsed: Dynamic;
    try {
      parsed = parseDynamicPix(code) as Dynamic;
    } catch {
      return;
    }
    if (!parsed.merchantName) return;
    return {
      type: "dynamic",
      brCode: code,
      ownerName: parsed.merchantName,
      city: parsed.merchantCity,
      country: parsed.countryCode && alpha2ToAlpha3(parsed.countryCode),
      postalCode: parsed.postalCode,
      oneTime: parsed.pointOfInitiationMethod === PointOfInitiationMethod.OnTimeOnly,
    } as const;
  }
}

function isBRCode(value: string) {
  return value.trimStart().startsWith("000201");
}

export function isPixKey(value: string) {
  return Object.values(keyDetector).some((detect) => detect(value));
}

export const pixAccount = pipe(
  string(),
  check((value) => isPixKey(value) || !isBRCode(value) || !!parseBRCode(value), "Invalid BR Code"),
  check((value) => isPixKey(value) || !!parseBRCode(value), "Invalid PIX key"),
);

export const taxDocument = pipe(
  string(),
  check((value) => isCPF(value) || isCNPJ(value), "Invalid CPF or CNPJ"),
);

type Static = {
  additionalData?: { txId?: string };
  countryCode?: string;
  merchantAccountInfo?: { key?: string };
  merchantCity?: string;
  merchantName?: string;
  postalCode?: string;
  value?: number;
};

type Dynamic = {
  countryCode?: string;
  merchantCity?: string;
  merchantName?: string;
  pointOfInitiationMethod?: PointOfInitiationMethod;
  postalCode?: string;
};
