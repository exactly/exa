// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable-v4/access/AccessControlUpgradeable.sol";
import {
  ERC20VotesUpgradeable
} from "@openzeppelin/contracts-upgradeable-v4/token/ERC20/extensions/ERC20VotesUpgradeable.sol";

contract EXYv2 is ERC20VotesUpgradeable, AccessControlUpgradeable {
  bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

  function initialize(address admin_) external initializer {
    __ERC20_init("exy", "EXY");
    __ERC20Permit_init("exy");
    __ERC20Votes_init();
    __AccessControl_init();
    _grantRole(DEFAULT_ADMIN_ROLE, admin_);
  }

  function initializeV2(address admin_) external reinitializer(2) {
    __AccessControl_init();
    _grantRole(DEFAULT_ADMIN_ROLE, admin_);
  }

  function mint(address to, uint256 amount) external onlyRole(BRIDGE_ROLE) {
    _mint(to, amount);
  }

  function burn(address from, uint256 amount) external onlyRole(BRIDGE_ROLE) {
    _burn(from, amount);
  }

  function clock() public view override returns (uint48) {
    return uint48(block.timestamp);
  }

  // solhint-disable-next-line func-name-mixedcase
  function CLOCK_MODE() public pure override returns (string memory) {
    return "mode=timestamp";
  }
}
