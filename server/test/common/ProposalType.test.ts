import { encodeAbiParameters, getAddress, padHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { decodeCrossRepayAtMaturity } from "@exactly/common/ProposalType";

const marketOut = getAddress(padHex("0xe7e4", { size: 20 }));

describe("cross repay at maturity proposal", () => {
  it.each([
    { name: "a long route", maxRepay: 420n, route: padHex("0x5a1ec7", { size: 300, dir: "right" }) },
    { name: "a max repay equal to the old route offset", maxRepay: 128n, route: padHex("0x5a1ec7", { size: 100 }) },
    { name: "an empty route", maxRepay: 420n, route: "0x" as Hex },
  ])("decodes the layout with market out and $name", ({ maxRepay, route }) => {
    const proposal = { maturity: 1_234_567n, positionAssets: 69n, marketOut, maxRepay, route };

    expect(decodeCrossRepayAtMaturity(encodeNew(proposal))).toStrictEqual(proposal);
  });

  it.each([
    { name: "a long route", route: padHex("0x5a1ec7", { size: 300, dir: "right" }) },
    { name: "a route as long as the new route offset", route: padHex("0x5a1ec7", { size: 160, dir: "right" }) },
    { name: "an empty route", route: "0x" as Hex },
  ])("decodes the layout without market out and $name", ({ route }) => {
    const proposal = { maturity: 1_234_567n, positionAssets: 69n, maxRepay: 420n, route };

    expect(decodeCrossRepayAtMaturity(encodeOld(proposal))).toStrictEqual(proposal);
  });
});

function encodeNew(proposal: {
  marketOut: Hex;
  maturity: bigint;
  maxRepay: bigint;
  positionAssets: bigint;
  route: Hex;
}) {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "maturity", type: "uint256" },
          { name: "positionAssets", type: "uint256" },
          { name: "marketOut", type: "address" },
          { name: "maxRepay", type: "uint256" },
          { name: "route", type: "bytes" },
        ],
      },
    ],
    [proposal],
  );
}

function encodeOld(proposal: { maturity: bigint; maxRepay: bigint; positionAssets: bigint; route: Hex }) {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "maturity", type: "uint256" },
          { name: "positionAssets", type: "uint256" },
          { name: "maxRepay", type: "uint256" },
          { name: "route", type: "bytes" },
        ],
      },
    ],
    [proposal],
  );
}
