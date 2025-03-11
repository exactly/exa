// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC4626 } from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { ExaPlugin } from "./ExaPlugin.sol";
import {
  BorrowAtMaturityData,
  DelaySet,
  IAuditor,
  IDebtManager,
  IInstallmentsRouter,
  IMarket,
  IProposalManager,
  InsufficientLiquidity,
  InvalidDelay,
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

  address public immutable SWAPPER;
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
    address swapper_,
    address collector_,
    address[] memory targets,
    uint256 delay_
  ) {
    AUDITOR = auditor;
    DEBT_MANAGER = debtManager;
    INSTALLMENTS_ROUTER = installmentsRouter;
    if (swapper_ == address(0)) revert ZeroAddress();
    SWAPPER = swapper_;

    _grantRole(COLLECTOR_ROLE, collector_);
    _grantRole(DEFAULT_ADMIN_ROLE, owner);

    for (uint256 i = 0; i < targets.length; ++i) {
      _allowTarget(targets[i], true);
    }
    _setDelay(delay_);
  }

  function nextProposal(address account) external view returns (Proposal memory proposal) {
    uint256 nonce = nonces[account];
    if (nonce == queueNonces[account]) revert NoProposal();
    proposal = proposals[account][nonce];
  }

  function shiftProposal(address account) internal returns (Proposal memory proposal) {
    uint256 nonce = nonces[account];
    if (nonce == queueNonces[account]) revert NoProposal();
    proposal = proposals[account][nonce];
    _setNonce(account, nonce + 1, true);
  }

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
    if (target == address(SWAPPER) || allowlist[target]) return;
    IMarket marketTarget = IMarket(target);
    if (!_isMarket(marketTarget)) revert Unauthorized();

    return _preExecutionMarketCheck(sender, marketTarget, selector, callData);
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
    } else if (selector == IERC20.transferFrom.selector) {
      (, receiver,) = abi.decode(callData, (address, address, uint256));
      if (receiver == address(DEBT_MANAGER) || receiver == address(INSTALLMENTS_ROUTER)) return;
      revert Unauthorized();
    } else if (selector == IMarket.borrowAtMaturity.selector) {
      return _checkBorrowAtMaturityProposal(sender, target, callData);
    } else if (selector == IERC4626.withdraw.selector) {
      (amount, receiver, owner) = abi.decode(callData, (uint256, address, address));
      if (hasRole(COLLECTOR_ROLE, receiver)) return;
      if (hasRole(PROPOSER_ROLE, receiver)) return _checkCallHash(target, selector, amount, receiver, owner);
      Proposal memory proposal = shiftProposal(owner);
      if (
        proposal.proposalType != ProposalType.CROSS_REPAY_AT_MATURITY
          && proposal.proposalType != ProposalType.REPAY_AT_MATURITY && proposal.proposalType != ProposalType.SWAP
          && proposal.proposalType != ProposalType.WITHDRAW
      ) revert NoProposal();
      return _checkMarketProposal(proposal, target, amount, receiver);
    } else if (selector == IERC4626.redeem.selector) {
      (amount, receiver, owner) = abi.decode(callData, (uint256, address, address));
      if (hasRole(PROPOSER_ROLE, receiver)) return _checkCallHash(target, selector, amount, receiver, owner);
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
  {
    if (ExaPlugin(payable(msg.sender)).callHash() != keccak256(abi.encode(target, selector, amount, receiver, owner))) {
      revert Unauthorized();
    }
  }

  function _checkMarketProposal(Proposal memory proposal, IMarket target, uint256 amount, address receiver)
    internal
    view
  {
    // slither-disable-next-line incorrect-equality -- unsigned zero check
    if (proposal.amount == 0) revert NoProposal();
    if (proposal.amount < amount) revert NoProposal();
    if (proposal.market != target) revert NoProposal();
    if (proposal.timestamp + delay > block.timestamp) revert Timelocked();
    if (proposal.proposalType == ProposalType.WITHDRAW || proposal.proposalType == ProposalType.REDEEM) {
      if (abi.decode(proposal.data, (address)) != receiver) revert NoProposal();
    }
  }

  function propose(address account, IMarket market, uint256 amount, ProposalType proposalType, bytes memory data)
    external
    onlyRole(PROPOSER_ROLE)
  {
    if (amount == 0) revert ZeroAmount();
    _checkMarket(market);
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
    if (nonce <= nonces[account]) revert NonceTooLow();
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
    if (!_isMarket(market)) revert NotMarket();
  }

  function _isMarket(IMarket market) internal view returns (bool) {
    return AUDITOR.markets(market).isListed;
  }

  function _setDelay(uint256 delay_) internal {
    if (delay_ == 0 || delay_ > 1 hours) revert InvalidDelay();
    delay = delay_;
    emit DelaySet(delay_);
  }
}
