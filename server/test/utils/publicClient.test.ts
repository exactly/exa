import { anvil } from "viem/chains";
import { describe, expect, it } from "vitest";

import { alchemyClient } from "../../utils/publicClient";

describe("alchemy client", () => {
  it("throws without an alchemy rpc url", () => {
    expect(() => alchemyClient({ ...anvil, rpcUrls: { default: anvil.rpcUrls.default } })).toThrow(
      "missing alchemy rpc url",
    );
  });
});
