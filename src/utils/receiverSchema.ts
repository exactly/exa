import { ChainType } from "@lifi/sdk";
import { base58, bech32, bech32m, createBase58check } from "@scure/base";
import { check, pipe, string, trim, type GenericSchema } from "valibot";
import { isAddressEqual, isHex, sha256, zeroAddress } from "viem";

import { Address } from "@exactly/common/validation";

export default function receiverSchema(chainType: ChainType): GenericSchema<string, string> {
  return schemas[chainType] ?? Address;
}

const schemas: Partial<Record<ChainType, GenericSchema<string, string>>> = {
  [ChainType.EVM]: pipe(
    string(),
    trim(),
    Address,
    check((input) => !isAddressEqual(input, zeroAddress), "bad address"),
  ),
  [ChainType.SVM]: pipe(string(), trim(), check(solana, "bad solana address")),
  [ChainType.TVM]: pipe(string(), trim(), check(tron, "bad tron address")),
  [ChainType.UTXO]: pipe(string(), trim(), check(bitcoin, "bad bitcoin address")), // cspell:ignore UTXO
  [ChainType.MVM]: pipe(
    string(),
    trim(),
    check((input) => isHex(input, { strict: true }) && input.length === 66, "bad sui address"),
  ),
};

const base58check = createBase58check((payload) => sha256(payload, "bytes"));

function solana(input: string) {
  try {
    return base58.decode(input).length === 32;
  } catch {
    return false;
  }
}

function tron(input: string) {
  try {
    const payload = base58check.decode(input);
    return payload.length === 21 && payload[0] === 0x41;
  } catch {
    return false;
  }
}

function bitcoin(input: string) {
  try {
    const payload = base58check.decode(input);
    if (payload.length === 21 && (payload[0] === 0 || payload[0] === 5)) return true;
  } catch {
    return segwit(input);
  }
  return segwit(input);
}

function segwit(input: string) {
  for (const coder of [bech32, bech32m]) {
    try {
      const { prefix, words } = coder.decode(input as `${string}1${string}`);
      const [version, ...data] = words;
      const length = coder.fromWords(data).length;
      if (
        prefix === "bc" &&
        version !== undefined &&
        version <= 16 &&
        length >= 2 &&
        length <= 40 &&
        (version === 0 ? coder === bech32 && (length === 20 || length === 32) : coder === bech32m)
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
