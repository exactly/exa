import { padHex, parseEther, zeroHash, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import anvil from "../anvil";

declare const EXPO_PUBLIC_E2E_MNEMONIC: string | undefined;
declare const output: { account: Address; owner: Address };

output.owner = mnemonicToAccount(
  EXPO_PUBLIC_E2E_MNEMONIC || "test test test test test test test test test test test junk", // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
).address;
output.account = deriveAddress(exaAccountFactoryAddress, { x: padHex(output.owner), y: zeroHash });
anvil("anvil_setBalance", [output.owner, String(parseEther("1000000"))]);
