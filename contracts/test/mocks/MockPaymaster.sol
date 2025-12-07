// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { IPaymaster, UserOperation } from "modular-account/src/interfaces/erc4337/IPaymaster.sol";

contract MockPaymaster is IPaymaster {
  function validatePaymasterUserOp(UserOperation calldata, bytes32, uint256)
    external
    pure
    returns (bytes memory, uint256)
  {
    return ("", 0);
  }

  function postOp(PostOpMode, bytes calldata, uint256) external { } // solhint-disable-line no-empty-blocks
}
