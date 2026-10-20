import { decodeAbiParameters, encodeAbiParameters } from "viem";

enum ProposalType {
  None,
  BorrowAtMaturity,
  CrossRepayAtMaturity,
  Redeem,
  RepayAtMaturity,
  RollDebt,
  Swap,
  Withdraw,
}
export default ProposalType;

export function decodeCrossRepayAtMaturity(data: `0x${string}`) {
  const parameters = [
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
  ] as const;
  try {
    const decoded = decodeAbiParameters(parameters, data);
    if (encodeAbiParameters(parameters, decoded) !== data.toLowerCase()) throw new Error("legacy layout");
    return decoded[0];
  } catch {
    return {
      ...decodeAbiParameters(
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
        data,
      )[0],
      marketOut: undefined,
    };
  }
}

export function decodeRepayAtMaturity(data: `0x${string}`) {
  return decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "maturity", type: "uint256" },
          { name: "positionAssets", type: "uint256" },
        ],
      },
    ],
    data,
  )[0];
}

export function decodeWithdraw(data: `0x${string}`) {
  return decodeAbiParameters([{ type: "address" }], data)[0];
}

export function decodeRollDebt(data: `0x${string}`) {
  return decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "repayMaturity", type: "uint256" },
          { name: "borrowMaturity", type: "uint256" },
          { name: "maxRepayAssets", type: "uint256" },
          { name: "percentage", type: "uint256" },
        ],
      },
    ],
    data,
  )[0];
}

export function decodeBorrowAtMaturity(data: `0x${string}`) {
  return decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "maturity", type: "uint256" },
          { name: "maxAssets", type: "uint256" },
          { name: "receiver", type: "address" },
        ],
      },
    ],
    data,
  )[0];
}
