// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC4626 } from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { ExaPlugin } from "./ExaPlugin.sol";
import {
  BorrowAtMaturityData,
  CrossRepayData,
  DelaySet,
  IAuditor,
  IDebtManager,
  IInstallmentsRouter,
  IMarket,
  IProposalManager,
  InsufficientLiquidity,
  InvalidDelay,
  InvalidProposal,
  MarketData,
  NoProposal,
  NonceTooLow,
  NotMarket,
  Proposal,
  ProposalNonceSet,
  ProposalType,
  Proposed,
  RollDebtData,
  TargetAllowed,
  Timelocked,
  Unauthorized,
  ZeroAddress,
  ZeroAmount
} from "./IExaAccount.sol";

contract ProposalManager is IProposalManager, AccessControl {
  using FixedPointMathLib for uint256;

  string public constant NAME = "ProposalManager";
  string public constant VERSION = "1";

  bytes32 public constant COLLECTOR_ROLE = keccak256("COLLECTOR_ROLE");
  bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");

  IAuditor public immutable AUDITOR;
  IDebtManager public immutable DEBT_MANAGER;
  IInstallmentsRouter public immutable INSTALLMENTS_ROUTER;

  uint256 public delay;
  mapping(address target => bool allowed) public allowlist;
  mapping(address account => uint256 nonce) public nonces;
  mapping(address account => uint256 nonce) public queueNonces;
  mapping(address account => mapping(uint256 nonce => Proposal lastProposal)) public proposals;

  constructor(
    address owner,
    IAuditor auditor,
    IDebtManager debtManager,
    IInstallmentsRouter installmentsRouter,
    address collector_,
    address[] memory targets,
    uint256 delay_
  ) {
    AUDITOR = auditor;
    DEBT_MANAGER = debtManager;
    INSTALLMENTS_ROUTER = installmentsRouter;

    _grantRole(COLLECTOR_ROLE, collector_);
    _grantRole(DEFAULT_ADMIN_ROLE, owner);

    for (uint256 i = 0; i < targets.length; ++i) {
      _allowTarget(targets[i], true);
    }
    _setDelay(delay_);
  }

  function nextProposal(address account) external view returns (uint256 nonce, Proposal memory proposal) {
    nonce = nonces[account];
    if (nonce == queueNonces[account]) revert NoProposal();
    proposal = proposals[account][nonce];
  }

  function shiftProposal(address account) internal returns (Proposal memory proposal) {
    uint256 nonce = nonces[account];
    if (nonce == queueNonces[account]) revert NoProposal();
    proposal = proposals[account][nonce];
    _setNonce(account, nonce + 1, true);
  }

  // solhint-disable-next-line gas-calldata-parameters
  function preExecutionChecker(address sender, address target, bytes4 selector, bytes memory callData)
    external
    onlyRole(PROPOSER_ROLE)
  {
    if (target == address(AUDITOR)) {
      if (selector != IAuditor.exitMarket.selector) return;
      revert Unauthorized();
    }
    if (target == address(DEBT_MANAGER)) {
      if (selector == IDebtManager.rollFixed.selector) {
        (
          IMarket market,
          uint256 repayMaturity,
          uint256 borrowMaturity,
          uint256 maxRepay,
          uint256 maxBorrow,
          uint256 percentage
        ) = abi.decode(callData, (IMarket, uint256, uint256, uint256, uint256, uint256));
        Proposal memory rollProposal = shiftProposal(sender);
        if (rollProposal.proposalType != ProposalType.ROLL_DEBT) revert NoProposal();
        if (rollProposal.timestamp + delay > block.timestamp) revert Timelocked();

        RollDebtData memory rollData = abi.decode(rollProposal.data, (RollDebtData));
        if (
          rollProposal.market != market || rollProposal.amount < maxBorrow || rollData.maxRepayAssets < maxRepay
            || rollData.percentage < percentage || rollData.repayMaturity != repayMaturity
            || rollData.borrowMaturity != borrowMaturity
        ) revert NoProposal();
        return;
      }
      revert Unauthorized();
    }
    if (target == address(INSTALLMENTS_ROUTER)) {
      if (selector == IInstallmentsRouter.borrow.selector) {
        (,,,, address receiver) = abi.decode(callData, (IMarket, uint256, uint256[], uint256, address));
        if (hasRole(COLLECTOR_ROLE, receiver)) return;
      }
      revert Unauthorized();
    }
    if (_isMarket(target)) return _preExecutionMarketCheck(sender, IMarket(target), selector, callData);
    if (!allowlist[target]) revert Unauthorized();
  }

  function _preExecutionMarketCheck(address sender, IMarket target, bytes4 selector, bytes memory callData) internal {
    uint256 amount = 0;
    address owner = address(0);
    address receiver = address(0);

    if (selector == IERC20.approve.selector) {
      (receiver,) = abi.decode(callData, (address, uint256));
      if (receiver == address(DEBT_MANAGER) || receiver == address(INSTALLMENTS_ROUTER)) return;
      revert Unauthorized();
    } else if (selector == IERC20.transfer.selector) {
      (receiver, amount) = abi.decode(callData, (address, uint256));
      Proposal memory proposal = shiftProposal(sender);
      if (proposal.proposalType != ProposalType.REDEEM) revert Unauthorized();
      return _checkMarketProposal(proposal, target, amount, receiver);
    } else if (selector == IMarket.borrowAtMaturity.selector) {
      return _checkBorrowAtMaturityProposal(sender, target, callData);
    } else if (selector == IERC4626.withdraw.selector) {
      (amount, receiver, owner) = abi.decode(callData, (uint256, address, address));
      if (hasRole(COLLECTOR_ROLE, receiver)) return;
      if (hasRole(PROPOSER_ROLE, receiver) && !_checkCallHash(target, selector, amount, receiver, owner)) return;
      Proposal memory proposal = shiftProposal(owner);
      if (
        proposal.proposalType != ProposalType.CROSS_REPAY_AT_MATURITY
          && proposal.proposalType != ProposalType.REPAY_AT_MATURITY && proposal.proposalType != ProposalType.SWAP
          && proposal.proposalType != ProposalType.WITHDRAW
      ) revert NoProposal();
      return _checkMarketProposal(proposal, target, amount, receiver);
    } else if (selector == IERC4626.redeem.selector) {
      (amount, receiver, owner) = abi.decode(callData, (uint256, address, address));
      if (hasRole(PROPOSER_ROLE, receiver) && !_checkCallHash(target, selector, amount, receiver, owner)) return;
      Proposal memory proposal = shiftProposal(owner);
      if (proposal.proposalType != ProposalType.REDEEM) revert NoProposal();
      return _checkMarketProposal(proposal, target, amount, receiver);
    } else if (selector == IMarket.borrow.selector) {
      (, receiver,) = abi.decode(callData, (uint256, address, address));
      if (!hasRole(COLLECTOR_ROLE, receiver)) revert Unauthorized();
      return;
    }
  }

  function _checkBorrowAtMaturityProposal(address sender, IMarket target, bytes memory callData) internal {
    (uint256 maturity, uint256 amount, uint256 maxAssets, address receiver,) =
      abi.decode(callData, (uint256, uint256, uint256, address, address));
    if (hasRole(COLLECTOR_ROLE, receiver)) return;

    Proposal memory proposal = shiftProposal(sender);
    if (proposal.proposalType == ProposalType.BORROW_AT_MATURITY) {
      if (proposal.timestamp + delay > block.timestamp) revert Timelocked();
      BorrowAtMaturityData memory borrowData = abi.decode(proposal.data, (BorrowAtMaturityData));
      if (
        borrowData.maturity != maturity || borrowData.maxAssets < maxAssets || borrowData.receiver != receiver
          || proposal.amount < amount || proposal.market != target
      ) {
        revert NoProposal();
      }
      return;
    }
    revert Unauthorized();
  }

  function _checkCallHash(IMarket target, bytes4 selector, uint256 amount, address receiver, address owner)
    internal
    view
    returns (bool shouldConsume)
  {
    bytes32 callHash = ExaPlugin(payable(msg.sender)).callHash();
    if (
      callHash | bytes32(uint256(1))
        != keccak256(abi.encode(target, selector, amount, receiver, owner)) | bytes32(uint256(1))
    ) {
      revert Unauthorized();
    }
    shouldConsume = callHash & bytes32(uint256(1)) == bytes32(uint256(1));
  }

  function _checkMarketProposal(Proposal memory proposal, IMarket target, uint256 amount, address receiver)
    internal
    view
  {
    if (proposal.amount < amount) revert NoProposal();
    if (proposal.market != target) revert NoProposal();
    if (proposal.timestamp + delay > block.timestamp) revert Timelocked();
    if (proposal.proposalType == ProposalType.WITHDRAW || proposal.proposalType == ProposalType.REDEEM) {
      if (hasRole(PROPOSER_ROLE, receiver)) return;
      if (abi.decode(proposal.data, (address)) != receiver) revert NoProposal();
    }
  }

  // solhint-disable-next-line gas-calldata-parameters
  function propose(address account, IMarket market, uint256 amount, ProposalType proposalType, bytes memory data)
    external
    onlyRole(PROPOSER_ROLE)
  {
    if (amount == 0) revert ZeroAmount();
    if (proposalType == ProposalType.NONE) revert InvalidProposal();
    _checkMarket(market);
    if (proposalType == ProposalType.CROSS_REPAY_AT_MATURITY) {
      _checkMarket(abi.decode(data, (CrossRepayData)).marketOut);
    }
    uint256 nonce = queueNonces[account];
    proposals[account][nonce] =
      Proposal({ amount: amount, market: market, timestamp: block.timestamp, proposalType: proposalType, data: data });
    queueNonces[account] = nonce + 1;
    emit Proposed(account, nonce, market, proposalType, amount, data, block.timestamp + delay);
  }

  function setNonce(address account, uint256 nonce) external onlyRole(PROPOSER_ROLE) {
    _setNonce(account, nonce, false);
  }

  function _setNonce(address account, uint256 nonce, bool executed) internal {
    if (nonce <= nonces[account]) revert NonceTooLow(); // solhint-disable-line gas-strict-inequalities
    if (nonce > queueNonces[account]) revert NoProposal();
    nonces[account] = nonce;
    emit ProposalNonceSet(account, nonce, executed);
  }

  function allowTarget(address target, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _allowTarget(target, allowed);
  }

  function setDelay(uint256 delay_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _setDelay(delay_);
  }

  function checkLiquidity(address account) external view {
    uint256 marketMap = AUDITOR.accountMarkets(account);
    uint256 sumCollateral = 0;
    uint256 sumDebtPlusEffects = 0;

    uint256 marketCount = AUDITOR.allMarkets().length;
    for (uint256 i = 0; i < marketCount; ++i) {
      // slither-disable-next-line calls-loop -- won't revert
      IMarket market = AUDITOR.marketList(i);
      if ((marketMap & (1 << i)) != 0) {
        // slither-disable-next-line calls-loop -- won't revert
        MarketData memory md = AUDITOR.markets(market);
        // slither-disable-next-line calls-loop -- won't revert
        uint256 price = uint256(md.priceFeed.latestAnswer());
        // slither-disable-next-line calls-loop -- won't revert
        (uint256 balance, uint256 borrowBalance) = market.accountSnapshot(account);

        sumCollateral += balance.mulDiv(price, 10 ** md.decimals).mulWad(md.adjustFactor);
        sumDebtPlusEffects += borrowBalance.mulDivUp(price, 10 ** md.decimals).divWadUp(md.adjustFactor);
      }
      if ((1 << i) > marketMap) break;
    }

    uint256 queueNonce = queueNonces[account];
    for (uint256 i = nonces[account]; i < queueNonce; ++i) {
      Proposal memory proposal = proposals[account][i];
      if (proposal.amount == 0) continue;
      // slither-disable-next-line calls-loop -- won't revert
      MarketData memory md = AUDITOR.markets(proposal.market);
      // slither-disable-next-line calls-loop -- won't revert
      uint256 price = uint256(md.priceFeed.latestAnswer());
      if (proposal.proposalType == ProposalType.ROLL_DEBT) {
        sumDebtPlusEffects += proposal.amount.mulDivUp(price, 10 ** md.decimals).divWadUp(md.adjustFactor);
      } else if (proposal.proposalType == ProposalType.BORROW_AT_MATURITY) {
        BorrowAtMaturityData memory borrowData = abi.decode(proposal.data, (BorrowAtMaturityData));
        sumDebtPlusEffects += borrowData.maxAssets.mulDivUp(price, 10 ** md.decimals).divWadUp(md.adjustFactor);
      } else {
        // slither-disable-next-line calls-loop -- won't revert
        uint256 assets = proposal.proposalType == ProposalType.REDEEM
          ? proposal.market.convertToAssets(proposal.amount)
          : proposal.amount;
        uint256 collateral = assets.mulDiv(price, 10 ** md.decimals).mulWad(md.adjustFactor);
        if (sumCollateral < collateral) revert InsufficientLiquidity();
        sumCollateral -= collateral;
      }
    }

    if (sumDebtPlusEffects > sumCollateral) revert InsufficientLiquidity();
  }

  function _allowTarget(address target, bool allowed) internal {
    if (target == address(0)) revert ZeroAddress();

    allowlist[target] = allowed;
    emit TargetAllowed(target, msg.sender, allowed);
  }

  function _checkMarket(IMarket market) internal view {
    if (!_isMarket(address(market))) revert NotMarket();
  }

  function _isMarket(address market) internal view returns (bool) {
    return AUDITOR.markets(IMarket(market)).isListed;
  }

  function _setDelay(uint256 delay_) internal {
    if (delay_ == 0 || delay_ > 1 hours) revert InvalidDelay();
    delay = delay_;
    emit DelaySet(delay_);
  }
}
