import { parse } from "valibot";
import { encodeAbiParameters, encodePacked, keccak256, slice, type Address as ViemAddress, type Hash } from "viem";

import { Address } from "./validation";

const accountImplementation = "0x0046000000000151008789797b54fdb500E2a61e";
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

export default function deriveAddress(factory: ViemAddress, { x, y }: { x: Hash; y: Hash }) {
  return parse(
    Address,
    slice(
      keccak256(
        encodePacked(
          ["uint8", "address", "bytes32", "bytes32"],
          [
            0xff,
            factory,
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
