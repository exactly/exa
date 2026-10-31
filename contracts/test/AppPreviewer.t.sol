// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";
import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";

import { AppPreviewer, MarketPreview, ProposalManagerPreview } from "../src/AppPreviewer.sol";
import { ExaPlugin } from "../src/ExaPlugin.sol";
import { IAuditor, IExaAccount, IMarket, IProposalManager } from "../src/IExaAccount.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

contract AppPreviewerTest is ForkTest {
  AppPreviewer internal previewer;
  DeployProtocol internal p;
  IAuditor internal auditor;

  function setUp() external {
    previewer = AppPreviewer(makeAddr("previewer"));
    vm.etch(address(previewer), type(AppPreviewer).runtimeCode);

    set("deployer", address(this));
    p = new DeployProtocol();
    p.run();
    auditor = IAuditor(address(p.auditor()));
  }

  // solhint-disable func-name-mixedcase

  function test_markets_returnsMarkets() external view {
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertEq(markets.length, 3);
    assertEq(markets[0].market, address(p.exaEXA()));
    assertEq(markets[1].market, address(p.exaUSDC()));
    assertEq(markets[2].market, address(p.exaWETH()));
    assertEq(markets[0].asset, address(p.exa()));
    assertEq(markets[1].asset, address(p.usdc()));
    assertEq(markets[2].asset, address(p.weth()));
    assertEq(markets[0].decimals, 18);
    assertEq(markets[1].decimals, 6);
    assertEq(markets[2].decimals, 18);
    assertEq(markets[0].usdPrice, 5e18);
    assertEq(markets[1].usdPrice, 1e18);
    assertEq(markets[2].usdPrice, 2500e18);
    assertEq(markets[0].symbol, "EXA");
    assertEq(markets[1].symbol, "USDC");
    assertEq(markets[2].symbol, "WETH");
    for (uint256 i = 0; i < markets.length; ++i) {
      assertFalse(markets[i].nonCollateral);
      assertFalse(markets[i].isFrozen);
    }
  }

  function test_markets_returnsFrozen() external {
    p.exaUSDC().setFrozen(true);
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertFalse(markets[0].isFrozen);
    assertTrue(markets[1].isFrozen);
    assertFalse(markets[2].isFrozen);
  }

  function test_markets_returnsNonCollateral() external {
    IMarket market = IMarket(address(p.exaUSDC()));
    vm.mockCall(address(auditor), abi.encodeCall(IAuditor.markets, (market)), abi.encode(auditor.markets(market), true));
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertFalse(markets[0].nonCollateral);
    assertTrue(markets[1].nonCollateral);
    assertFalse(markets[2].nonCollateral);
    assertEq(markets[1].usdPrice, 1e18);
  }

  function test_proposalManager_returnsPreview() external {
    address account = _mockAccount();
    ProposalManagerPreview memory preview = previewer.proposalManager(account);
    assertEq(preview.proposalManager, makeAddr("manager"));
    assertEq(preview.delay, 1 minutes);
    assertEq(preview.queueNonce, 2);
    assertEq(preview.nonce, 1);
  }

  function test_proposalManager_returnsEmpty_whenAccountIsNotDeployed() external view {
    _assertEmpty(previewer.proposalManager(address(0xdead)));
  }

  function test_proposalManager_returnsEmpty_whenAddressIsNotAccount() external view {
    _assertEmpty(previewer.proposalManager(address(auditor)));
  }

  function test_proposalManager_returnsEmpty_whenAccountHasNoPlugin() external {
    address account = _mockAccount();
    vm.mockCall(
      account,
      abi.encodeCall(IAccountLoupe.getExecutionFunctionConfig, (IExaAccount.propose.selector)),
      abi.encode(address(0), bytes21(0), bytes21(0))
    );
    _assertEmpty(previewer.proposalManager(account));
  }

  function test_proposalManager_returnsEmpty_whenPluginHasNoProposalManager() external {
    address account = _mockAccount();
    vm.mockCallRevert(
      makeAddr("plugin"), abi.encodeCall(ExaPlugin(payable(makeAddr("plugin"))).proposalManager, ()), ""
    );
    _assertEmpty(previewer.proposalManager(account));
  }

  // solhint-enable func-name-mixedcase

  function _mockAccount() internal returns (address account) {
    account = makeAddr("account");
    address plugin = makeAddr("plugin");
    address manager = makeAddr("manager");
    vm.etch(account, hex"00");
    vm.etch(plugin, hex"00");
    vm.etch(manager, hex"00");
    vm.mockCall(
      account,
      abi.encodeCall(IAccountLoupe.getExecutionFunctionConfig, (IExaAccount.propose.selector)),
      abi.encode(plugin, bytes21(0), bytes21(0))
    );
    vm.mockCall(plugin, abi.encodeCall(ExaPlugin(payable(plugin)).proposalManager, ()), abi.encode(manager));
    vm.mockCall(manager, abi.encodeCall(IProposalManager.delay, ()), abi.encode(1 minutes));
    vm.mockCall(manager, abi.encodeCall(IProposalManager.queueNonces, (account)), abi.encode(2));
    vm.mockCall(manager, abi.encodeCall(IProposalManager.nonces, (account)), abi.encode(1));
  }

  function _assertEmpty(ProposalManagerPreview memory preview) internal pure {
    assertEq(preview.proposalManager, address(0));
    assertEq(preview.delay, 0);
    assertEq(preview.queueNonce, 0);
    assertEq(preview.nonce, 0);
  }
}
