// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

contract BalancePreviewer {
  function balances(address account, address[] calldata tokens) external view returns (uint256[] memory amounts) {
    amounts = new uint256[](tokens.length);
    for (uint256 i = 0; i < tokens.length; ++i) {
      address token = tokens[i];
      if (token == address(0)) {
        amounts[i] = account.balance;
        continue;
      }
      uint256 amount = 0;
      // solhint-disable no-inline-assembly
      // slither-disable-next-line assembly
      assembly ("memory-safe") {
        // solhint-enable no-inline-assembly
        let ptr := mload(0x40)
        mstore(ptr, shl(224, 0x70a08231))
        mstore(add(ptr, 4), account)
        let success := staticcall(gas(), token, ptr, 36, 0, 32)
        if and(success, eq(returndatasize(), 32)) { amount := mload(0) }
      }
      amounts[i] = amount;
    }
  }
}
