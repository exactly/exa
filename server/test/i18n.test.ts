import { describe, expect, it } from "vitest";

import t, { f } from "../i18n";

describe("f()", () => {
  describe("number input", () => {
    it("preserves sub-micro values", () => {
      expect(f(0.000_000_9)).toStrictEqual({ en: "0.0000009", es: "0,0000009" });
    });

    it("preserves 6 fractional digits", () => {
      expect(f(0.000_001)).toStrictEqual({ en: "0.000001", es: "0,000001" });
    });

    it("formats regular decimals", () => {
      expect(f(99.973)).toStrictEqual({ en: "99.973", es: "99,973" });
    });

    it("formats integers", () => {
      expect(f(5)).toStrictEqual({ en: "5", es: "5" });
    });

    it("formats thousands with separator", () => {
      expect(f(1000)).toStrictEqual({ en: "1,000", es: "1.000" });
    });
  });

  describe("string input", () => {
    it("formats regular decimals", () => {
      expect(f("99.973")).toStrictEqual({ en: "99.973", es: "99,973" });
    });

    it("preserves sub-micro values and trims trailing zeros", () => {
      expect(f("0.00000090")).toStrictEqual({ en: "0.0000009", es: "0,0000009" });
    });

    it("formats integers", () => {
      expect(f("5")).toStrictEqual({ en: "5", es: "5" });
    });
  });
});

describe("t()", () => {
  it("returns en and es translations with no options", () => {
    const result = t("Card purchase");
    expect(result).toStrictEqual({ en: "Card purchase", es: "Compra con tarjeta" }); // cspell:ignore Compra tarjeta
  });

  it("interpolates plain string values into both languages", () => {
    const result = t("{{localAmount}} at {{merchantName}}. Paid with USDC", {
      localAmount: "$1,234.56",
      merchantName: "Store",
    });
    expect(result).toStrictEqual({
      en: "$1,234.56 at Store. Paid with USDC",
      es: "$1,234.56 en Store. Pagado con USDC", // cspell:ignore Pagado
    });
  });

  it("resolves per-language objects in interpolation values", () => {
    const result = t("{{localAmount}} at {{merchantName}}. Paid with USDC", {
      localAmount: { en: "$1,234.56", es: "$ 1.234,56" },
      merchantName: "Store",
    });
    expect(result).toStrictEqual({
      en: "$1,234.56 at Store. Paid with USDC",
      es: "$ 1.234,56 en Store. Pagado con USDC", // cspell:ignore Pagado
    });
  });

  it("mixes per-language and plain values", () => {
    const result = t("{{localAmount}} at {{merchantName}}. Paid with credit", {
      localAmount: { en: "A", es: "B" },
      merchantName: "Store",
    });
    expect(result).toStrictEqual({
      en: "A at Store. Paid with credit",
      es: "B en Store. Pagado con crédito", // cspell:ignore Pagado crédito
    });
  });
});
