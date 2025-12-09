import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { describe, expect, it } from "vitest";

import getCardType from "../../utils/getCardType";

describe("getting card type", () => {
  it("returns VISA_SIGNATURE for signature product id", () => {
    const result = getCardType(SIGNATURE_PRODUCT_ID);

    expect(result).toBe("VISA_SIGNATURE");
  });

  it("returns PLATINUM for platinum product id", () => {
    const result = getCardType(PLATINUM_PRODUCT_ID);

    expect(result).toBe("PLATINUM");
  });

  it("returns PLATINUM for unknown product id", () => {
    const result = getCardType("unknown-product-id");

    expect(result).toBe("PLATINUM");
  });
});
