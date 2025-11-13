// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC4626 } from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";

interface IExaAccount {
  function swap(IERC20 assetIn, IERC20 assetOut, uint256 maxAmountIn, uint256 minAmountOut, bytes memory route)
    external
    returns (uint256 amountIn, uint256 amountOut);
  function executeProposal(uint256 nonce) external;
  function executeProposals(uint256 firstNonce, uint256 count) external;
  function propose(IMarket market, uint256 amount, ProposalType proposalType, bytes memory data) external;
  function proposeRepay(IMarket market, uint256 amount, ProposalType proposalType, bytes memory data) external;
  function setProposalNonce(uint256 nonce) external;
  function collectCollateral(
    uint256 amount,
    IMarket collateral,
    uint256 maxAmountIn,
    uint256 timestamp,
    bytes memory route,
    bytes calldata signature
  ) external returns (uint256, uint256);
  function collectCredit(uint256 maturity, uint256 amount, uint256 timestamp, bytes calldata signature) external;
  function collectCredit(
    uint256 maturity,
    uint256 amount,
    uint256 maxRepay,
    uint256 timestamp,
    bytes calldata signature
  ) external;
  function collectDebit(uint256 amount, uint256 timestamp, bytes calldata signature) external;
  function collectInstallments(
    uint256 firstMaturity,
    uint256[] calldata amounts,
    uint256 maxRepay,
    uint256 timestamp,
    bytes calldata signature
  ) external;
  function poke(IMarket market) external;
  function pokeETH() external;
}

interface IProposalManager {
  function checkLiquidity(address account) external view;
  function delay() external view returns (uint256);
  function nextProposal(address account) external view returns (uint256 nonce, Proposal memory proposal);
  function nonces(address account) external view returns (uint256);
  function preExecutionChecker(address sender, address target, bytes4 selector, bytes memory callData) external;
  function proposals(address account, uint256 nonce)
    external
    view
    returns (uint256, IMarket, uint256, ProposalType, bytes memory);
  function propose(address account, IMarket market, uint256 amount, ProposalType proposalType, bytes memory data)
    external;
  function queueNonces(address account) external view returns (uint256);
  function setNonce(address account, uint256 nonce) external;
}

interface IDebtManager {
  function rollFixed(
    IMarket market,
    uint256 repayMaturity,
    uint256 borrowMaturity,
    uint256 maxRepayAssets,
    uint256 maxBorrowAssets,
    uint256 percentage
  ) external;
}

interface IInstallmentsRouter {
  function borrow(IMarket market, uint256 firstMaturity, uint256[] calldata amounts, uint256 maxRepay, address receiver)
    external
    returns (uint256[] memory assetsOwed);
}

interface IFlashLoaner {
  function flashLoan(address recipient, IERC20[] memory tokens, uint256[] memory amounts, bytes memory data) external;
}

event FlashLoanerSet(address indexed account, IFlashLoaner indexed flashLoaner);

event CollectorSet(address indexed collector, address indexed account);

event DelaySet(uint256 delay);

event PluginAllowed(address indexed plugin, address indexed sender, bool allowed);

event ProposalManagerSet(IProposalManager indexed proposalManager, address indexed account);

event ProposalNonceSet(address indexed account, uint256 indexed nonce, bool indexed executed);

event Proposed(
  address indexed account,
  uint256 indexed nonce,
  IMarket indexed market,
  ProposalType proposalType,
  uint256 amount,
  bytes data,
  uint256 unlock
);

event SwapperSet(address indexed swapper, address indexed sender);

event TargetAllowed(address indexed target, address indexed sender, bool allowed);

struct FixedPool {
  uint256 borrowed;
  uint256 supplied;
  uint256 unassignedEarnings;
  uint256 lastAccrual;
}

struct FixedPosition {
  uint256 principal;
  uint256 fee;
}

struct MarketData {
  uint128 adjustFactor;
  uint8 decimals;
  uint8 index;
  bool isListed;
  IPriceFeed priceFeed;
}

struct Proposal {
  uint256 amount;
  IMarket market;
  uint256 timestamp;
  ProposalType proposalType;
  bytes data;
}

struct SwapData {
  IERC20 assetOut;
  uint256 minAmountOut;
  bytes route;
}

struct RollDebtData {
  uint256 repayMaturity;
  uint256 borrowMaturity;
  uint256 maxRepayAssets;
  uint256 percentage;
}

struct BorrowAtMaturityData {
  uint256 maturity;
  uint256 maxAssets;
  address receiver;
}

struct CrossRepayData {
  uint256 maturity;
  uint256 positionAssets;
  IMarket marketOut;
  uint256 maxRepay;
  bytes route;
}

struct RepayData {
  uint256 maturity;
  uint256 positionAssets;
}

enum ProposalType {
  NONE,
  BORROW_AT_MATURITY,
  CROSS_REPAY_AT_MATURITY,
  REDEEM,
  REPAY_AT_MATURITY,
  ROLL_DEBT,
  SWAP,
  WITHDRAW
}

error BorrowLimitExceeded();
error Disagreement();
error Expired();
error ExtensionFailed();
error InsufficientLiquidity();
error NotNext();
error NoBalance();
error NonceTooLow();
error NoProposal();
error NotMarket();
error PendingProposals();
error Replay();
error Timelocked();
error Unauthorized();
error ZeroAddress();
error InvalidDelay();
error InvalidProposal();
error ZeroAmount();

interface IAuditor {
  function accountMarkets(address account) external view returns (uint256);
  function allMarkets() external view returns (IMarket[] memory);
  function assetPrice(IPriceFeed priceFeed) external view returns (uint256);
  function enterMarket(IMarket market) external;
  function exitMarket(IMarket market) external;
  function marketList(uint256 index) external view returns (IMarket);
  function markets(IMarket market) external view returns (MarketData memory);
}

interface IMarket is IERC4626 {
  function accountSnapshot(address account) external view returns (uint256, uint256);
  function backupFeeRate() external view returns (uint256);
  function borrow(uint256 assets, address receiver, address borrower) external returns (uint256 borrowShares);
  function borrowAtMaturity(uint256 maturity, uint256 assets, uint256 maxAssets, address receiver, address borrower)
    external
    returns (uint256 assetsOwed);
  function depositAtMaturity(uint256 maturity, uint256 assets, uint256 minAssetsRequired, address receiver)
    external
    returns (uint256 positionAssets);
  function fixedBorrowPositions(uint256 maturity, address borrower) external view returns (FixedPosition memory);
  function fixedPools(uint256 maturity) external view returns (FixedPool memory);
  function isFrozen() external view returns (bool);
  function penaltyRate() external view returns (uint256);
  function repay(uint256 assets, address borrower) external;
  function repayAtMaturity(uint256 maturity, uint256 positionAssets, uint256 maxAssets, address borrower)
    external
    returns (uint256 actualRepayAssets);
  function setFrozen(bool frozen) external;
  function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
  function withdrawAtMaturity(
    uint256 maturity,
    uint256 positionAssets,
    uint256 minAssetsRequired,
    address receiver,
    address owner
  ) external returns (uint256 assetsDiscounted);
}

interface IPriceFeed {
  function decimals() external view returns (uint8);
  function latestAnswer() external view returns (int256);
}
