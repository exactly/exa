import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";
import { describe, expect, it } from "vitest";

import { deriveFactories } from "../../utils/validFactories";

describe("valid factories", () => {
  it("keeps create3 factories as legacy on optimism sepolia", () => {
    expect(deriveFactories(optimismSepolia.id, true)).toStrictEqual({
      valid: new Set(["0xb29bAFff6E4fd67Cb6a56657237F66CcE468844D", "0xb8DAb7aeF51744246c46dCa75EfcFC0b6dD4e346"]),
      legacy: new Set(["0x98d3E8B291d9E89C25D8371b7e8fFa8BC32E0aEC"]),
    });
  });

  it("keeps create3 1.1.0 valid and 1.0.0 legacy on base sepolia", () => {
    expect(deriveFactories(baseSepolia.id, true)).toStrictEqual({
      valid: new Set([
        "0xb29bAFff6E4fd67Cb6a56657237F66CcE468844D",
        "0xb8DAb7aeF51744246c46dCa75EfcFC0b6dD4e346",
        "0xD72aDc8D0eb528aA1D355A47D65fa2e6A21a5d36",
      ]),
      legacy: new Set(["0x343EfD4E2073afc4CBe304b5dD50F8d6480e2dD2"]),
    });
  });

  it("keeps mainnet factories", () => {
    for (const id of [optimism.id, base.id]) {
      expect(deriveFactories(id, false)).toStrictEqual({
        valid: new Set(["0x961EbA47650e2198A959Ef5f337E542df5E4F61b", "0xAd92a288CE0cc869129cDA518Af2baaf69fFa026"]),
        legacy: new Set(),
      });
    }
  });
});
