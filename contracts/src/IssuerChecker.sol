// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";

import { ECDSA } from "solady/utils/ECDSA.sol";
import { EIP712 } from "solady/utils/EIP712.sol";

import { Expired, Replay, Timelocked, Unauthorized, ZeroAddress } from "./IExaAccount.sol";

contract IssuerChecker is AccessControl, EIP712 {
  using ECDSA for bytes32;

  string public constant NAME = "IssuerChecker";
  string public constant VERSION = "1";
  uint256 public constant MAX_TIME_DRIFT = 1 minutes;

  address public issuer;
  uint256 public operationExpiry;
  address public prevIssuer;
  uint256 public prevIssuerTimestamp;
  uint256 public prevIssuerWindow;
  mapping(address account => mapping(bytes32 hash => bool used)) public collections;
  mapping(address account => mapping(bytes32 hash => bool used)) public refunds;

  constructor(address owner, address issuer_, uint256 operationExpiry_, uint256 prevIssuerWindow_) {
    _grantRole(DEFAULT_ADMIN_ROLE, owner);
    _setIssuer(issuer_);
    _setOperationExpiry(operationExpiry_);
    _setPrevIssuerWindow(prevIssuerWindow_);
  }

  function checkIssuer(address account, uint256 amount, uint256 timestamp, bytes calldata signature) external {
    check(account, amount, timestamp, false, signature);
  }

  function check(address account, uint256 amount, uint256 timestamp, bool refund, bytes calldata signature) public {
    if (timestamp > block.timestamp + MAX_TIME_DRIFT) revert Timelocked();
    if (timestamp + operationExpiry < block.timestamp) revert Expired();

    bytes32 hash = keccak256(abi.encode(amount, timestamp)); // forge-lint: disable-line(asm-keccak256)
    address recovered;
    // solhint-disable gas-small-strings
    if (refund) {
      if (refunds[account][hash]) revert Replay();
      refunds[account][hash] = true;
      emit Refunded(account, amount, timestamp);
      recovered = _hashTypedData(
          keccak256(
            abi.encode(keccak256("Refund(address account,uint256 amount,uint40 timestamp)"), account, amount, timestamp)
          )
        ).recoverCalldata(signature);
    } else {
      if (collections[account][hash]) revert Replay();
      collections[account][hash] = true;
      emit Collected(account, amount, timestamp);
      recovered = _hashTypedData(
          keccak256(
            abi.encode(
              keccak256("Collection(address account,uint256 amount,uint40 timestamp)"), account, amount, timestamp
            )
          )
        ).recoverCalldata(signature);
    }
    // solhint-enable gas-small-strings

    // solhint-disable-next-line gas-strict-inequalities
    if (recovered == issuer || (recovered == prevIssuer && block.timestamp <= prevIssuerWindow + prevIssuerTimestamp)) {
      return;
    }

    revert Unauthorized();
  }

  function setIssuer(address issuer_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _setIssuer(issuer_);
  }

  function setOperationExpiry(uint256 operationExpiry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _setOperationExpiry(operationExpiry_);
  }

  function setPrevIssuerWindow(uint256 prevIssuerWindow_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _setPrevIssuerWindow(prevIssuerWindow_);
  }

  // solhint-disable-next-line func-name-mixedcase
  function DOMAIN_SEPARATOR() public view returns (bytes32) {
    return _domainSeparator();
  }

  function _domainNameAndVersion() internal pure override returns (string memory name, string memory version) {
    name = NAME;
    version = VERSION;
  }

  function _setIssuer(address issuer_) internal {
    if (issuer_ == address(0)) revert ZeroAddress();
    prevIssuer = issuer;
    prevIssuerTimestamp = block.timestamp;
    issuer = issuer_;
    emit IssuerSet(issuer_, msg.sender);
  }

  function _setOperationExpiry(uint256 operationExpiry_) internal {
    if (operationExpiry_ == 0) revert InvalidOperationExpiry();
    operationExpiry = operationExpiry_;
    emit OperationExpirySet(msg.sender, operationExpiry_);
  }

  function _setPrevIssuerWindow(uint256 prevIssuerWindow_) internal {
    prevIssuerWindow = prevIssuerWindow_;
    emit PrevIssuerWindowSet(msg.sender, prevIssuerWindow_);
  }
}

event Collected(address indexed account, uint256 amount, uint256 timestamp);

event IssuerSet(address indexed issuer, address indexed account);

event OperationExpirySet(address indexed account, uint256 operationExpiry);

event PrevIssuerWindowSet(address indexed account, uint256 prevIssuerWindow);

event Refunded(address indexed account, uint256 amount, uint256 timestamp);

error InvalidOperationExpiry();
