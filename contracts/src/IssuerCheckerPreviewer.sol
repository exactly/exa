// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { EfficientHashLib } from "solady/utils/EfficientHashLib.sol";

import { Expired, Replay, Timelocked } from "./IExaAccount.sol";

/// @notice issuer checker code for authorization traces: same storage as the issuer checker, checks
///         without the signature.
contract IssuerCheckerPreviewer {
  uint256 public constant MAX_TIME_DRIFT = 1 minutes;

  // slither-disable-next-line unused-state,constable-states -- issuer checker storage
  uint256[2] private __gap0;
  // slither-disable-next-line uninitialized-state,constable-states -- issuer checker storage
  uint256 private operationExpiry;
  // slither-disable-next-line unused-state,constable-states -- issuer checker storage
  uint256[3] private __gap1;
  mapping(address account => mapping(bytes32 hash => bool used)) private collections;

  function checkIssuer(address account, uint256 amount, uint256 timestamp, bytes calldata) external {
    if (timestamp > block.timestamp + MAX_TIME_DRIFT) revert Timelocked();
    if (timestamp + operationExpiry < block.timestamp) revert Expired();

    bytes32 hash = EfficientHashLib.hash(amount, timestamp);
    if (collections[account][hash]) revert Replay();
    collections[account][hash] = true;
  }
}
