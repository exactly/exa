import { encodeAbiParameters, encodePacked, getAddress, keccak256, slice, type Address, type Hash } from "viem";

import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import deploy from "@exactly/plugin/deploy.json";

const PROXY_INIT_CODE_HASH: Hash = "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f";

const create3Factory: Address =
  chain.id === 11_155_420
    ? "0xcc3f41204a1324DD91F1Dbfc46208535293A371e"
    : chain.id === 84_532
      ? "0x9f275F6D25232FFf082082a53C62C6426c1cc94C"
      : "0x93FEC2C00BfE902F733B57c5a6CeeD7CD1384AE1";

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- testnet chain ids missing from deploy.json
const admin = (deploy.accounts.admin[String(chain.id) as keyof typeof deploy.accounts.admin] ??
  deploy.accounts.admin.default) as Address;

const versions: [string, string][] = [
  ["Account Plugin", "0.0.1"],
  ["Exa Plugin", "0.0.2"],
  ["Exa Plugin", "0.0.3"],
  ["Exa Plugin", "0.0.4"],
  ["Exa Plugin", "0.0.5"],
  ["Exa Plugin", "1.0.0"],
  ["Exa Plugin", "1.1.0"],
];

const validFactories = new Set<string>(
  versions.map(([name, version]) =>
    deriveCreate3(admin, keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], [name, version]))),
  ),
);

if (!validFactories.has(exaAccountFactoryAddress)) throw new Error("factory derivation mismatch");

export default validFactories;

function deriveCreate3(deployer: Address, salt: Hash): Address {
  const combined = keccak256(encodePacked(["address", "bytes32"], [deployer, salt]));
  const proxy = slice(
    keccak256(
      encodePacked(["uint8", "address", "bytes32", "bytes32"], [0xff, create3Factory, combined, PROXY_INIT_CODE_HASH]),
    ),
    12,
  );
  return getAddress(slice(keccak256(encodePacked(["bytes2", "address", "uint8"], ["0xd694", proxy, 0x01])), 12));
}
