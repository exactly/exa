// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0; // solhint-disable-line one-contract-per-file

import { stdJson } from "forge-std/StdJson.sol";
import { LibString } from "solady/utils/LibString.sol";

library JSON {
  using LibString for uint256;
  using ChainKey for string;
  using stdJson for string;

  function readChainAddress(string memory json, string memory key) internal view returns (address) {
    string memory chainKey = key.toChain();
    return json.keyExists(chainKey) ? json.readAddress(chainKey) : json.readAddress(key.toDefault());
  }

  function readChainUint(string memory json, string memory key) internal view returns (uint256) {
    string memory chainKey = key.toChain();
    return json.keyExists(chainKey) ? json.readUint(chainKey) : json.readUint(key.toDefault());
  }
}

library ChainKey {
  using LibString for uint256;

  function toChain(string memory key) internal view returns (string memory) {
    return string.concat(key, ".", block.chainid.toString());
  }

  function toDefault(string memory key) internal pure returns (string memory) {
    return string.concat(key, ".default");
  }
}
