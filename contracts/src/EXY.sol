// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { ERC20VotesUpgradeable } from
  "@openzeppelin/contracts-upgradeable-v4/token/ERC20/extensions/ERC20VotesUpgradeable.sol";

contract EXY is ERC20VotesUpgradeable {
  function initialize() external initializer {
    __ERC20_init("exy", "EXY");
    __ERC20Permit_init("exy");
    __ERC20Votes_init();
    _mint(msg.sender, 10_000_000e18);
  }

  function clock() public view override returns (uint48) {
    return uint48(block.timestamp);
  }

  // solhint-disable-next-line func-name-mixedcase
  function CLOCK_MODE() public pure override returns (string memory) {
    return "mode=timestamp";
  }
}
