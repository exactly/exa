import { ChainId } from "@lifi/sdk";
import { pipe, regex, string, trim, type GenericSchema } from "valibot";

import { Address } from "@exactly/common/validation";

export default function receiverSchema(chainId: number): GenericSchema<string, string> {
  return schemas[chainId] ?? Address;
}

const schemas: Record<number, GenericSchema<string, string>> = {
  [ChainId.SOL]: pipe(string(), trim(), regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "bad solana address")),
  [ChainId.TRN]: pipe(string(), trim(), regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/, "bad tron address")),
  [ChainId.BTC]: pipe(
    string(),
    trim(),
    regex(/^(?:bc1[\da-z]{39,71}|[13][\dA-HJ-NP-Za-km-z]{25,34})$/, "bad bitcoin address"),
  ),
  [ChainId.SUI]: pipe(string(), trim(), regex(/^0x[\da-f]{64}$/i, "bad sui address")),
};
