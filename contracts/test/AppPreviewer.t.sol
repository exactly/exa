// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";
import { Previewer } from "@exactly/protocol/periphery/Previewer.sol";
import { RatePreviewer } from "@exactly/protocol/periphery/RatePreviewer.sol";
import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";

import {
  AccountPreview,
  AppPreviewer,
  MarketPreview,
  ProposalManagerPreview,
  Protocol,
  WalletPreview
} from "../src/AppPreviewer.sol";
import { ExaPlugin } from "../src/ExaPlugin.sol";
import {
  IAuditor,
  IExaAccount,
  IMarket,
  IProposalManager,
  PendingProposal,
  ProposalType
} from "../src/IExaAccount.sol";
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
    MarketPreview[] memory markets = _markets();
    assertEq(markets.length, 3);
    assertEq(address(markets[0].market.market), address(p.exaEXA()));
    assertEq(address(markets[1].market.market), address(p.exaUSDC()));
    assertEq(address(markets[2].market.market), address(p.exaWETH()));
    assertEq(markets[0].market.asset, address(p.exa()));
    assertEq(markets[1].market.asset, address(p.usdc()));
    assertEq(markets[2].market.asset, address(p.weth()));
    assertEq(markets[0].market.decimals, 18);
    assertEq(markets[1].market.decimals, 6);
    assertEq(markets[2].market.decimals, 18);
    assertEq(markets[0].market.usdPrice, 5e18);
    assertEq(markets[1].market.usdPrice, 1e18);
    assertEq(markets[2].market.usdPrice, 2500e18);
    assertEq(markets[0].market.symbol, "exaEXA");
    assertEq(markets[1].market.symbol, "exaUSDC");
    assertEq(markets[2].market.symbol, "exaWETH");
    for (uint256 i = 0; i < markets.length; ++i) {
      assertFalse(markets[i].nonCollateral);
      assertFalse(markets[i].isFrozen);
    }
  }

  function test_markets_returnsFrozen() external {
    p.exaUSDC().setFrozen(true);
    MarketPreview[] memory markets = _markets();
    assertFalse(markets[0].isFrozen);
    assertTrue(markets[1].isFrozen);
    assertFalse(markets[2].isFrozen);
  }

  function test_markets_returnsNonCollateral() external {
    IMarket market = IMarket(address(p.exaUSDC()));
    vm.mockCall(address(auditor), abi.encodeCall(IAuditor.markets, (market)), abi.encode(auditor.markets(market), true));
    MarketPreview[] memory markets = _markets();
    assertFalse(markets[0].nonCollateral);
    assertTrue(markets[1].nonCollateral);
    assertFalse(markets[2].nonCollateral);
    assertEq(markets[1].market.usdPrice, 1e18);
  }

  // solhint-enable func-name-mixedcase

  function _markets() internal view returns (MarketPreview[] memory) {
    return previewer.preview(address(this), new address[](0), Protocol(auditor, p.previewer(), p.ratePreviewer()))
      .protocol
      .markets;
  }
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

  function test_proposals_returnsQueuedProposals() external {
    PendingProposal[] memory proposals = _wallet(_mockAccount()).proposals;
    assertEq(proposals.length, 1);
    assertEq(proposals[0].nonce, 1);
    assertEq(proposals[0].unlock, 1 hours + 1 minutes);
    assertEq(proposals[0].proposal.amount, 100e6);
    assertEq(address(proposals[0].proposal.market), makeAddr("market"));
    assertEq(proposals[0].proposal.timestamp, 1 hours);
    assertTrue(proposals[0].proposal.proposalType == ProposalType.WITHDRAW);
    assertEq(abi.decode(proposals[0].proposal.data, (address)), address(0x1));
  }

  function test_proposals_returnsEmpty_whenAccountIsNotDeployed() external view {
    assertEq(_wallet(address(0xdead)).proposals.length, 0);
  }

  function test_proposals_returnsEmpty_whenAddressIsNotAccount() external view {
    assertEq(_wallet(address(auditor)).proposals.length, 0);
  }

  function test_proposalManager_returnsPreview() external {
    address account = _mockAccount();
    ProposalManagerPreview memory preview = _proposalManager(account);
    assertEq(preview.proposalManager, makeAddr("proposalManager"));
    assertEq(preview.delay, 1 minutes);
    assertEq(preview.queueNonce, 2);
    assertEq(preview.nonce, 1);
  }

  function test_proposalManager_returnsEmpty_whenAccountIsNotDeployed() external view {
    _assertEmpty(_proposalManager(address(0xdead)));
  }

  function test_proposalManager_returnsEmpty_whenAddressIsNotAccount() external view {
    _assertEmpty(_proposalManager(address(auditor)));
  }

  function test_proposalManager_returnsEmpty_whenAccountHasNoPlugin() external {
    address account = _mockAccount();
    vm.mockCall(
      account,
      abi.encodeCall(IAccountLoupe.getExecutionFunctionConfig, (IExaAccount.propose.selector)),
      abi.encode(address(0), bytes21(0), bytes21(0))
    );
    _assertEmpty(_proposalManager(account));
  }

  function test_proposalManager_returnsEmpty_whenPluginHasNoProposalManager() external {
    address account = _mockAccount();
    vm.mockCallRevert(
      makeAddr("plugin"), abi.encodeCall(ExaPlugin(payable(makeAddr("plugin"))).proposalManager, ()), ""
    );
    _assertEmpty(_proposalManager(account));
  }

  // solhint-enable func-name-mixedcase

  function _proposalManager(address account) internal view returns (ProposalManagerPreview memory) {
    return _wallet(account).proposalManager;
  }

  function _wallet(address account) internal view returns (WalletPreview memory) {
    return previewer.preview(
      account, new address[](0), Protocol(IAuditor(address(0)), Previewer(address(0)), RatePreviewer(address(0)))
    )
    .wallet;
  }

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
    vm.mockCall(
      proposalManager,
      abi.encodeCall(IProposalManager.proposals, (account, 1)),
      abi.encode(100e6, makeAddr("market"), 1 hours, ProposalType.WITHDRAW, abi.encode(address(0x1)))
    );
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
    vm.mockCall(
      proposalManager,
      abi.encodeCall(IProposalManager.proposals, (account, 1)),
      abi.encode(100e6, makeAddr("market"), 1 hours, ProposalType.WITHDRAW, abi.encode(address(0x1)))
    );
  }

  // solhint-disable func-name-mixedcase

  function test_preview_returnsProtocolReads() external {
    vm.warp(1 days);
    AccountPreview memory preview = _preview(new address[](0));
    Previewer.MarketAccount[] memory exactly = p.previewer().exactly(account);
    assertEq(preview.protocol.markets.length, exactly.length);
    for (uint256 i = 0; i < exactly.length; ++i) {
      assertEq(abi.encode(preview.protocol.markets[i].market), abi.encode(exactly[i]));
      assertEq(
        preview.protocol.markets[i].floatingAssetsAverage,
        IMarket(address(exactly[i].market)).previewFloatingAssetsAverage()
      );
    }
    assertEq(abi.encode(preview.protocol.rates), abi.encode(p.ratePreviewer().snapshot()));
    assertEq(preview.wallet.timestamp, 1 days);
    assertEq(preview.wallet.proposalManager.proposalManager, proposalManager);
    assertEq(preview.wallet.proposalManager.delay, 1 minutes);
    assertEq(preview.wallet.proposalManager.queueNonce, 2);
    assertEq(preview.wallet.proposalManager.nonce, 1);
    assertEq(preview.wallet.allowed.length, 0);
  }

  function test_preview_returnsMarkets_whenRateSnapshotReverts() external {
    vm.mockCallRevert(address(p.ratePreviewer()), abi.encodeCall(RatePreviewer.snapshot, ()), "");
    AccountPreview memory preview = _preview(new address[](0));
    assertEq(preview.protocol.markets.length, 3);
    assertEq(preview.protocol.rates.length, 0);
  }

  function test_preview_returnsAllowedInTargetOrder(address[3] calldata targets, bool[3] calldata allowed) external {
    vm.assume(targets[0] != targets[1] && targets[0] != targets[2] && targets[1] != targets[2]);
    address[] memory candidates = new address[](3);
    for (uint256 i = 0; i < candidates.length; ++i) {
      candidates[i] = targets[i];
      vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.allowlist, (targets[i])), abi.encode(allowed[i]));
    }
    AccountPreview memory preview = _preview(candidates);
    uint256 count = 0;
    for (uint256 i = 0; i < candidates.length; ++i) {
      if (!allowed[i]) continue;
      assertEq(preview.wallet.allowed[count], candidates[i]);
      ++count;
    }
    assertEq(preview.wallet.allowed.length, count);
  }

  function test_preview_returnsNoAllowed_whenAccountHasNoProposalManager() external view {
    address[] memory targets = new address[](2);
    targets[0] = address(p.usdc());
    targets[1] = address(p.weth());
    AccountPreview memory preview =
      previewer.preview(address(0xdead), targets, Protocol(auditor, p.previewer(), p.ratePreviewer()));
    assertEq(preview.wallet.proposalManager.proposalManager, address(0));
    assertEq(preview.wallet.allowed.length, 0);
  }

  function test_preview_skipsProtocolReads_whenAuditorHasNoCode() external {
    address[] memory targets = new address[](1);
    targets[0] = makeAddr("token");
    vm.mockCall(proposalManager, abi.encodeCall(IProposalManager.allowlist, (targets[0])), abi.encode(true));
    AccountPreview memory preview = previewer.preview(
      account, targets, Protocol(IAuditor(address(0)), Previewer(address(0)), RatePreviewer(address(0)))
    );
    assertEq(preview.protocol.markets.length, 0);
    assertEq(preview.protocol.rates.length, 0);
    assertEq(preview.wallet.timestamp, block.timestamp);
    assertEq(preview.wallet.proposalManager.proposalManager, proposalManager);
    assertEq(preview.wallet.allowed.length, 1);
    assertEq(preview.wallet.allowed[0], targets[0]);
  }

  function test_preview_skipsProtocolReads_whenPreviewerHasNoCode() external view {
    AccountPreview memory preview =
      previewer.preview(account, new address[](0), Protocol(auditor, Previewer(address(0)), p.ratePreviewer()));
    assertEq(preview.protocol.markets.length, 0);
    assertEq(preview.protocol.rates.length, 0);
  }

  function test_preview_returnsWalletBalances() external {
    p.usdc().mint(account, 420e6);
    p.weth().mint(account, 2e18);
    vm.deal(account, 3 ether);
    AccountPreview memory preview = _preview(new address[](0));
    assertEq(preview.wallet.balance, 3 ether);
    for (uint256 i = 0; i < preview.protocol.markets.length; ++i) {
      address asset = preview.protocol.markets[i].market.asset;
      assertEq(
        preview.protocol.markets[i].balance, asset == address(p.usdc()) ? 420e6 : asset == address(p.weth()) ? 2e18 : 0
      );
    }
  }

  // solhint-enable func-name-mixedcase

  function _preview(address[] memory targets) internal view returns (AccountPreview memory) {
    return previewer.preview(account, targets, Protocol(auditor, p.previewer(), p.ratePreviewer()));
  }
}
