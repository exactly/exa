import { exaAccountFactoryAddress } from "@exactly/common/generated/contracts";
import { checksumAddress, encodeAbiParameters, encodePacked, keccak256, slice } from "viem";

import decodePublicKey from "./decodePublicKey";

const accountImplementation = "0x0046000000000151008789797b54fdb500E2a61e" as const;
const initCodeHashERC1967 = keccak256(
  encodePacked(
    ["bytes", "address", "bytes"],
    [
      "0x603d3d8160223d3973",
      accountImplementation,
      "0x60095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3",
    ],
  ),
);

export default function deriveAddress(publicKey: Uint8Array) {
  const { x, y } = decodePublicKey(publicKey);
  return checksumAddress(
    slice(
      keccak256(
        encodePacked(
          ["uint8", "address", "bytes32", "bytes32"],
          [
            0xff,
            exaAccountFactoryAddress,
            keccak256(
              encodeAbiParameters(
                [{ type: "uint256" }, { type: "bytes" }],
                [
                  0n,
                  encodeAbiParameters(
                    [
                      {
                        type: "tuple[]",
                        components: [
                          { name: "x", type: "bytes32" },
                          { name: "y", type: "bytes32" },
                        ],
                      },
                    ],
                    [[{ x, y }]],
                  ),
                ],
              ),
            ),
            initCodeHashERC1967,
          ],
        ),
      ),
      12,
    ),
  );
}
