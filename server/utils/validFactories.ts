import { encodeAbiParameters, encodePacked, getAddress, keccak256, slice, type Address, type Hash } from "viem";
import { baseSepolia, optimismSepolia } from "viem/chains";

import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import deploy from "@exactly/plugin/deploy.json";

const PROXY_INIT_CODE_HASH = "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f" as const;

const create3Factory: Address =
  chain.id === optimismSepolia.id
    ? "0xcc3f41204a1324DD91F1Dbfc46208535293A371e"
    : chain.id === baseSepolia.id
      ? "0x9f275F6D25232FFf082082a53C62C6426c1cc94C"
      : "0x93FEC2C00BfE902F733B57c5a6CeeD7CD1384AE1";

const admin = getAddress(
  (deploy.accounts.admin as Record<string, string>)[String(chain.id)] ?? deploy.accounts.admin.default,
);

const validFactories = new Set(
  ["1.0.0", "1.1.0"].map((version) =>
    deriveCreate3(
      admin,
      keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], ["Exa Plugin", version])),
    ),
  ),
);

if (!validFactories.has(exaAccountFactoryAddress)) throw new Error("missing latest factory");

export default validFactories;

function deriveCreate3(deployer: Address, salt: Hash): Address {
  const proxy = slice(
    keccak256(
      encodePacked(
        ["uint8", "address", "bytes32", "bytes32"],
        [0xff, create3Factory, keccak256(encodePacked(["address", "bytes32"], [deployer, salt])), PROXY_INIT_CODE_HASH],
      ),
    ),
    12,
  );
  return getAddress(slice(keccak256(encodePacked(["bytes2", "address", "uint8"], ["0xd694", proxy, 0x01])), 12));
}
