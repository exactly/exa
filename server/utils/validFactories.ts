import { encodeAbiParameters, encodePacked, getAddress, keccak256, slice, type Address, type Hash } from "viem";
import { baseSepolia, optimismSepolia } from "viem/chains";

import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import deploy from "@exactly/plugin/deploy.json";

const PROXY_INIT_CODE_HASH = "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f" as const;

const createx = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed" as const;

const { valid: validFactories, legacy: legacyFactories } = deriveFactories(chain.id, !!chain.testnet);

if (!validFactories.has(exaAccountFactoryAddress)) throw new Error("missing latest factory");

export default validFactories;

export { legacyFactories };

export function deriveFactories(chainId: number, testnet: boolean) {
  const admin = getAddress(
    (deploy.accounts.admin as Record<string, string>)[String(chainId)] ?? deploy.accounts.admin.default,
  );
  function derive(factory: Address, versions: readonly string[]) {
    return new Set(
      versions.map((version) =>
        deriveCreate3(
          factory,
          admin,
          keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], ["Exa Plugin", version])),
        ),
      ),
    );
  }
  const create3 = testnet
    ? (
        {
          [optimismSepolia.id]: { factory: "0xcc3f41204a1324DD91F1Dbfc46208535293A371e", valid: [], legacy: ["1.0.0"] },
          [baseSepolia.id]: {
            factory: "0x9f275F6D25232FFf082082a53C62C6426c1cc94C",
            valid: ["1.1.0"],
            legacy: ["1.0.0"],
          },
        } as Partial<Record<number, { factory: Address; legacy: string[]; valid: string[] }>>
      )[chainId]
    : undefined;
  return {
    valid: new Set([
      ...derive(testnet ? createx : "0x93FEC2C00BfE902F733B57c5a6CeeD7CD1384AE1", ["1.0.0", "1.1.0"]),
      ...(create3 ? derive(create3.factory, create3.valid) : []),
    ]),
    legacy: create3 ? derive(create3.factory, create3.legacy) : new Set<Address>(),
  };
}

function deriveCreate3(factory: Address, deployer: Address, salt: Hash): Address {
  const proxy = slice(
    keccak256(
      encodePacked(
        ["uint8", "address", "bytes32", "bytes32"],
        [
          0xff,
          factory,
          factory === createx
            ? keccak256(
                encodeAbiParameters(
                  [{ type: "address" }, { type: "bytes32" }],
                  [deployer, encodePacked(["address", "bytes1", "bytes11"], [deployer, "0x00", slice(salt, 0, 11)])],
                ),
              )
            : keccak256(encodePacked(["address", "bytes32"], [deployer, salt])),
          PROXY_INIT_CODE_HASH,
        ],
      ),
    ),
    12,
  );
  return getAddress(slice(keccak256(encodePacked(["bytes2", "address", "uint8"], ["0xd694", proxy, 0x01])), 12));
}
