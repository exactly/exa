// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { BalancePreviewer } from "../src/BalancePreviewer.sol";

contract BalancePreviewerTest is Test {
  MockERC20 internal token;
  address internal account;

  function setUp() external {
    token = new MockERC20("Token", "TKN", 18);
    account = makeAddr("account");
    token.mint(account, 42);
    vm.deal(account, 7);
  }

  function _balances(address[] memory tokens) internal returns (uint256[] memory) {
    return abi.decode(abi.encodePacked(uint256(32), address(new BalancePreviewer(account, tokens)).code), (uint256[]));
  }

  // solhint-disable func-name-mixedcase

  function test_balances_returnsTokenAndNativeBalances() external {
    address[] memory tokens = new address[](2);
    tokens[0] = address(token);
    tokens[1] = address(0);
    uint256[] memory amounts = _balances(tokens);
    assertEq(amounts[0], 42);
    assertEq(amounts[1], 7);
  }

  function test_balances_returnsZero_whenTokenMisbehaves() external {
    address[] memory tokens = new address[](4);
    tokens[0] = address(new Reverter());
    tokens[1] = address(new Short());
    tokens[2] = address(new Burner());
    tokens[3] = makeAddr("eoa");
    uint256[] memory amounts = _balances(tokens);
    for (uint256 i = 0; i < tokens.length; ++i) {
      assertEq(amounts[i], 0);
    }
  }

  function test_balances_returnsBalance_whenTokenIsExpensive() external {
    address[] memory tokens = new address[](1);
    tokens[0] = address(new Expensive());
    uint256[] memory amounts = _balances(tokens);
    assertEq(amounts[0], 42);
  }

  function test_balances_keepsOrder_whenTokenMisbehaves() external {
    address[] memory tokens = new address[](3);
    tokens[0] = address(new Burner());
    tokens[1] = address(token);
    tokens[2] = address(new Long());
    uint256[] memory amounts = _balances(tokens);
    assertEq(amounts[0], 0);
    assertEq(amounts[1], 42);
    assertEq(amounts[2], 0);
  }
}

contract Reverter {
  fallback() external {
    // solhint-disable-next-line no-inline-assembly
    assembly ("memory-safe") {
      revert(0, 0)
    }
  }
}

contract Short {
  fallback() external {
    // solhint-disable-next-line no-inline-assembly
    assembly ("memory-safe") {
      mstore(0, 1)
      return(0, 16)
    }
  }
}

contract Long {
  fallback() external {
    // solhint-disable-next-line no-inline-assembly
    assembly ("memory-safe") {
      mstore(0, 1)
      return(0, 64)
    }
  }
}

contract Expensive {
  function balanceOf(address) external view returns (uint256) {
    uint256 start = gasleft();
    uint256 spins = 0;
    while (start - gasleft() < 200_000) ++spins;
    return 42;
  }
}

contract Burner {
  fallback() external {
    // solhint-disable-next-line no-inline-assembly
    assembly ("memory-safe") {
      invalid()
    }
  }
}
