// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";

import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { Expired, IMarket, Replay, Timelocked, Unauthorized } from "../src/IExaAccount.sol";
import { IssuerChecker } from "../src/IssuerChecker.sol";
import { Refunder } from "../src/Refunder.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

contract RefunderTest is ForkTest {
  address internal keeper;
  uint256 internal keeperKey;
  address internal issuer;
  uint256 internal issuerKey;
  IssuerChecker internal issuerChecker;
  bytes32 internal domainSeparator;
  Refunder internal refunder;

  IMarket internal exaUSDC;
  MockERC20 internal usdc;
  address internal bob = address(0xb0b);

  function setUp() external {
    DeployProtocol p = new DeployProtocol();
    p.run();

    exaUSDC = IMarket(address(p.exaUSDC()));
    usdc = p.usdc();

    (keeper, keeperKey) = makeAddrAndKey("keeper");
    (issuer, issuerKey) = makeAddrAndKey("issuer");

    issuerChecker = new IssuerChecker(address(this), issuer, 15 minutes, 10 days);

    refunder = new Refunder(address(this), exaUSDC, issuerChecker, keeper);

    domainSeparator = issuerChecker.DOMAIN_SEPARATOR();
    deal(address(usdc), address(refunder), 10_000e6);
  }

  // solhint-disable func-name-mixedcase
  function test_refund_refunds() external {
    vm.startPrank(keeper);
    uint256 amount = 100e6;
    assertEq(exaUSDC.balanceOf(address(bob)), 0);
    refunder.refund(bob, amount, block.timestamp, _issuerOp(bob, amount, block.timestamp));
    assertEq(exaUSDC.balanceOf(bob), amount);
  }

  function test_refund_toleratesTimeDrift() external {
    vm.startPrank(keeper);
    uint256 amount = 100e6;
    assertEq(exaUSDC.balanceOf(address(bob)), 0);
    uint256 timestamp = block.timestamp + 1 minutes;
    refunder.refund(bob, amount, timestamp, _issuerOp(bob, amount, timestamp));
    assertEq(exaUSDC.balanceOf(bob), amount);
  }

  function test_refund_reverts_whenTimelocked() external {
    vm.startPrank(keeper);
    assertEq(exaUSDC.balanceOf(address(bob)), 0);

    uint256 amount = 100e6;
    uint256 timestamp = block.timestamp + 2 minutes;
    vm.expectRevert(Timelocked.selector);
    refunder.refund(bob, amount, timestamp, _issuerOp(bob, amount, timestamp));

    assertEq(exaUSDC.balanceOf(bob), 0);
  }

  function test_refund_reverts_whenNotKeeper() external {
    uint256 amount = 100e6;
    assertEq(exaUSDC.balanceOf(address(bob)), 0);

    vm.expectRevert(Unauthorized.selector);
    refunder.refund(bob, amount, block.timestamp, _issuerOp(bob, amount, block.timestamp));
    assertEq(exaUSDC.balanceOf(bob), 0);
  }

  function test_refund_reverts_whenWrongSignature() external {
    vm.startPrank(keeper);
    uint256 amount = 100e6;
    assertEq(exaUSDC.balanceOf(address(bob)), 0);

    vm.expectRevert(Unauthorized.selector);
    refunder.refund(bob, amount, block.timestamp, _sign(issuerKey, keccak256("not the right message")));
    assertEq(exaUSDC.balanceOf(bob), 0);
  }

  function test_refund_reverts_whenExpired() external {
    vm.startPrank(keeper);
    uint256 amount = 100e6;
    assertEq(exaUSDC.balanceOf(address(bob)), 0);

    uint256 timestamp = block.timestamp;
    skip(issuerChecker.operationExpiry() + 1);

    vm.expectRevert(Expired.selector);
    refunder.refund(bob, amount, timestamp, _issuerOp(bob, amount, timestamp));
    assertEq(exaUSDC.balanceOf(bob), 0);
  }

  function test_refund_reverts_whenReplay() external {
    vm.startPrank(keeper);
    uint256 amount = 100e6;
    assertEq(exaUSDC.balanceOf(address(bob)), 0);

    uint256 timestamp = block.timestamp;
    refunder.refund(bob, amount, timestamp, _issuerOp(bob, amount, timestamp));
    assertEq(exaUSDC.balanceOf(bob), amount);

    vm.expectRevert(Replay.selector);
    refunder.refund(bob, amount, timestamp, _issuerOp(bob, amount, timestamp));
    assertEq(exaUSDC.balanceOf(bob), amount);
  }

  function test_withdraw_withdraws() external {
    refunder.withdraw(address(usdc), address(0x666), 100e6);
    assertEq(usdc.balanceOf(address(0x666)), 100e6);
  }

  function test_withdraw_reverts_whenNotAdmin() external {
    address notAdmin = address(0x123);
    vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, notAdmin, 0));
    vm.prank(notAdmin);
    refunder.withdraw(address(usdc), address(this), 100e6);
  }

  // solhint-enable func-name-mixedcase

  function _issuerOp(address account, uint256 amount, uint256 timestamp)
    internal
    view
    returns (bytes memory signature)
  {
    return _sign(
      issuerKey,
      keccak256(
        abi.encodePacked(
          "\x19\x01",
          domainSeparator,
          keccak256(
            abi.encode(keccak256("Refund(address account,uint256 amount,uint40 timestamp)"), account, amount, timestamp)
          )
        )
      )
    );
  }

  function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory) {
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
    return abi.encodePacked(r, s, v);
  }
}
