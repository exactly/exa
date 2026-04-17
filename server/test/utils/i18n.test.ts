import { describe, expect, it } from "vitest";

import t, { f } from "../../i18n";

describe("f", () => {
  it("preserves sub-micro values for number input", () => {
    expect(f(0.000_000_9)).toStrictEqual({ en: "0.0000009", es: "0,0000009", pt: "0,0000009" });
  });

  it("preserves 6 fractional digits for number input", () => {
    expect(f(0.000_001)).toStrictEqual({ en: "0.000001", es: "0,000001", pt: "0,000001" });
  });

  it("trims trailing zeros for string input", () => {
    expect(f("0.00000090")).toStrictEqual({ en: "0.0000009", es: "0,0000009", pt: "0,0000009" });
  });
});

describe("t", () => {
  it("falls back to english keys and translates supported languages", () => {
    expect(t("Funds received")).toStrictEqual({
      en: "Funds received",
      es: "Fondos recibidos", // cspell:ignore fondos recibidos
      pt: "Fundos recebidos", // cspell:ignore fundos recebidos
    });
  });

  it("uses localized interpolation values", () => {
    expect(t("{{amount}} {{asset}} deposited", { amount: f("1000.5"), asset: "USDC" })).toStrictEqual({
      en: "1,000.5 USDC deposited",
      es: "1.000,5 USDC depositados", // cspell:ignore depositados
      pt: "1.000,5 USDC depositados", // cspell:ignore depositados
    });
  });

  it("supports zero, credit, and installment plural overrides", () => {
    expect(
      t("{{amount}} at {{merchantName}}. Paid in {{count}} installments", {
        count: 0,
        amount: f(42.5, "USD"),
        merchantName: "cafe",
      }),
    ).toStrictEqual({
      en: "$42.50 at cafe. Paid with USDC",
      es: "US$ 42,50 en cafe. Pagado con USDC", // cspell:ignore pagado
      pt: "US$ 42,50 em cafe. Pago com USDC", // cspell:ignore pago
    });
    expect(
      t("{{amount}} at {{merchantName}}. Paid in {{count}} installments", {
        count: 1,
        amount: f(42.5, "USD"),
        merchantName: "cafe",
      }),
    ).toStrictEqual({
      en: "$42.50 at cafe. Paid with credit",
      es: "US$ 42,50 en cafe. Pagado con crédito", // cspell:ignore pagado crédito
      pt: "US$ 42,50 em cafe. Pago no crédito", // cspell:ignore pago crédito
    });
    expect(
      t("{{amount}} at {{merchantName}}. Paid in {{count}} installments", {
        count: 3,
        amount: f(42.5, "USD"),
        merchantName: "cafe",
      }),
    ).toStrictEqual({
      en: "$42.50 at cafe. Paid in 3 installments",
      es: "US$ 42,50 en cafe. Pagado en 3 cuotas", // cspell:ignore pagado cuotas
      pt: "US$ 42,50 em cafe. Pago em 3 parcelas", // cspell:ignore pago parcelas
    });
  });
});
