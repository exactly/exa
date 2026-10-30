// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { LibBytes } from "solady/utils/LibBytes.sol";

/// forge-lint: disable-next-line(unused-import)
import { ForkTest, stdError, stdJson } from "../test/Fork.t.sol"; // solhint-disable-line no-unused-import

abstract contract BaseScript is ForkTest {
  using LibBytes for bytes;

  function deployment(string memory path) internal returns (string memory) {
    string[] memory git = new string[](3);
    git[0] = "git";
    git[1] = "show";
    git[2] = path;
    return string(vm.ffi(git));
  }

  function initCode(string memory path, uint256 argumentsLength) internal returns (bytes memory code) {
    code = vm.parseJsonBytes(deployment(path), ".transactions[0].transaction.input");
    code = code.slice(0, code.length - argumentsLength);
  }

  function broadcastArguments(string memory name) internal view returns (bytes memory) {
    return vm.parseJsonBytes(
        vm.readFile(string.concat("broadcast/", name, ".s.sol/", vm.toString(block.chainid), "/run-latest.json")),
        ".transactions[0].transaction.input"
      )
      .slice(vm.getCode(string.concat(name, ".sol:", name)).length);
  }
}
