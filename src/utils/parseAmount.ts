import { parseUnits } from "viem"; // eslint-disable-line no-restricted-imports -- single entry point for decimal parsing

import reportError from "./reportError";

export default function parseAmount(value: string | undefined, decimals = 6): bigint {
  if (!value) return 0n;
  try {
    return parseUnits(value, decimals);
  } catch (error) {
    reportError(error);
    return 0n;
  }
}
