// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";
import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";

import { AppPreviewer, MarketPreview, NetworkPreview, ProposalManagerPreview } from "../src/AppPreviewer.sol";
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

  // solhint-enable func-name-mixedcase
}

contract AppPreviewerProposalManagerTest is ForkTest {
  AppPreviewer internal previewer;
  IAuditor internal auditor;

  function setUp() external {
    previewer = AppPreviewer(makeAddr("previewer"));
    vm.etch(address(previewer), type(AppPreviewer).runtimeCode);

    set("deployer", address(this));
    DeployProtocol p = new DeployProtocol();
    p.run();
    auditor = IAuditor(address(p.auditor()));
  }

  // solhint-disable func-name-mixedcase

  function test_proposalManager_returnsPreview() external {
    address account = _mockAccount();
    ProposalManagerPreview memory preview = previewer.proposalManager(account);
    assertEq(preview.proposalManager, makeAddr("proposalManager"));
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
    address proposalManager = makeAddr("proposalManager");
    vm.etch(account, hex"00");
    vm.etch(plugin, hex"00");
    vm.etch(proposalManager, hex"00");
    vm.mockCall(
      account,
      abi.encodeCall(IAccountLoupe.getExecutionFunctionConfig, (IExaAccount.propose.selector)),
      abi.encode(plugin, bytes21(0), bytes21(0))
    );
    vm.mockCall(plugin, abi.encodeCall(ExaPlugin(payable(plugin)).proposalManager, ()), abi.encode(proposalManager));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.delay, ()), abi.encode(1 minutes));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.queueNonces, (account)), abi.encode(2));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.nonces, (account)), abi.encode(1));
  }

  function _assertEmpty(ProposalManagerPreview memory preview) internal pure {
    assertEq(preview.proposalManager, address(0));
    assertEq(preview.delay, 0);
    assertEq(preview.queueNonce, 0);
    assertEq(preview.nonce, 0);
  }
}

contract AppPreviewerPreviewTest is ForkTest {
  AppPreviewer internal previewer;
  DeployProtocol internal p;
  IAuditor internal auditor;
  address internal account;
  address internal proposalManager;

  function setUp() external {
    previewer = AppPreviewer(makeAddr("previewer"));
    vm.etch(address(previewer), type(AppPreviewer).runtimeCode);

    set("deployer", address(this));
    p = new DeployProtocol();
    p.run();
    auditor = IAuditor(address(p.auditor()));
    p.exa().mint(address(this), 1000e18);
    p.usdc().mint(address(this), 1000e6);
    p.weth().mint(address(this), 1e18);
    p.exa().approve(address(p.exaEXA()), 1000e18);
    p.usdc().approve(address(p.exaUSDC()), 1000e6);
    p.weth().approve(address(p.exaWETH()), 1e18);
    p.exaEXA().deposit(1000e18, address(this));
    p.exaUSDC().deposit(1000e6, address(this));
    p.exaWETH().deposit(1e18, address(this));

    account = makeAddr("account");
    address plugin = makeAddr("plugin");
    proposalManager = makeAddr("proposalManager");
    vm.etch(account, hex"00");
    vm.etch(plugin, hex"00");
    vm.etch(proposalManager, hex"00");
    vm.mockCall(
      account,
      abi.encodeCall(IAccountLoupe.getExecutionFunctionConfig, (IExaAccount.propose.selector)),
      abi.encode(plugin, bytes21(0), bytes21(0))
    );
    vm.mockCall(plugin, abi.encodeCall(ExaPlugin(payable(plugin)).proposalManager, ()), abi.encode(proposalManager));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.delay, ()), abi.encode(1 minutes));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.queueNonces, (account)), abi.encode(2));
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.nonces, (account)), abi.encode(1));
  }

  // solhint-disable func-name-mixedcase

  function test_preview_returnsProtocolReads() external {
    vm.warp(1 days);
    NetworkPreview memory preview = _preview(new address[](0));
    assertEq(preview.markets.length, 3);
    assertEq(preview.markets[1].market, address(p.exaUSDC()));
    assertEq(preview.exactly, abi.encode(p.previewer().exactly(account)));
    assertEq(preview.snapshot, abi.encode(p.ratePreviewer().snapshot()));
    assertEq(preview.timestamp, 1 days);
    assertEq(preview.floatingAssetsAverage, p.exaUSDC().previewFloatingAssetsAverage());
    assertEq(preview.proposalManager.proposalManager, proposalManager);
    assertEq(preview.proposalManager.delay, 1 minutes);
    assertEq(preview.proposalManager.queueNonce, 2);
    assertEq(preview.proposalManager.nonce, 1);
    assertEq(preview.allowed.length, 0);
  }

  function test_preview_returnsMarkets_whenRateSnapshotReverts() external {
    vm.mockCallRevert(address(p.ratePreviewer()), abi.encodeWithSignature("snapshot()"), "");
    NetworkPreview memory preview = _preview(new address[](0));
    assertEq(preview.markets.length, 3);
    assertEq(preview.exactly, abi.encode(p.previewer().exactly(account)));
    assertEq(preview.snapshot.length, 0);
  }

  function test_preview_returnsAllowedInTargetOrder(address[3] calldata targets, bool[3] calldata allowed) external {
    vm.assume(targets[0] != targets[1] && targets[0] != targets[2] && targets[1] != targets[2]);
    address[] memory candidates = new address[](3);
    for (uint256 i = 0; i < candidates.length; ++i) {
      candidates[i] = targets[i];
      vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.allowlist, (targets[i])), abi.encode(allowed[i]));
    }
    NetworkPreview memory preview = _preview(candidates);
    assertEq(preview.allowed.length, 3);
    for (uint256 i = 0; i < candidates.length; ++i) {
      assertEq(preview.allowed[i], allowed[i]);
    }
  }

  function test_preview_returnsNotAllowed_whenAccountHasNoProposalManager() external view {
    address[] memory targets = new address[](2);
    targets[0] = address(p.usdc());
    targets[1] = address(p.weth());
    NetworkPreview memory preview = previewer.preview(
      address(0xdead),
      auditor,
      address(p.previewer()),
      address(p.ratePreviewer()),
      IMarket(address(p.exaUSDC())),
      targets
    );
    assertEq(preview.proposalManager.proposalManager, address(0));
    assertEq(preview.allowed.length, 2);
    assertFalse(preview.allowed[0]);
    assertFalse(preview.allowed[1]);
  }

  function test_preview_skipsProtocolReads_whenNetworkHasNoProtocol() external {
    address[] memory targets = new address[](1);
    targets[0] = makeAddr("token");
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.allowlist, (targets[0])), abi.encode(true));
    NetworkPreview memory preview =
      previewer.preview(account, IAuditor(address(0)), address(0), address(0), IMarket(address(0)), targets);
    assertEq(preview.markets.length, 0);
    assertEq(preview.exactly.length, 0);
    assertEq(preview.snapshot.length, 0);
    assertEq(preview.floatingAssetsAverage, 0);
    assertEq(preview.timestamp, block.timestamp);
    assertEq(preview.proposalManager.proposalManager, proposalManager);
    assertTrue(preview.allowed[0]);
  }

  // solhint-enable func-name-mixedcase

  function _preview(address[] memory targets) internal view returns (NetworkPreview memory) {
    return previewer.preview(
      account, auditor, address(p.previewer()), address(p.ratePreviewer()), IMarket(address(p.exaUSDC())), targets
    );
  }
}
