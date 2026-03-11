// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { LibString } from "solady/utils/LibString.sol";
import { Surl } from "surl/Surl.sol";

import { BaseScript, stdJson } from "./Base.s.sol";

contract SafePropose is BaseScript {
  using LibString for address;
  using LibString for bytes;
  using LibString for uint256;
  using stdJson for string;
  using Surl for string;

  IMultiSendCallOnly internal constant MULTISEND = IMultiSendCallOnly(0x9641d764fc13c8B624c04430C7356C1C7C8102e2); // github.com/safe-global/safe-deployments v1.4.1

  function run(string calldata path) external {
    string memory json = vm.readFile(path); // forge-lint: disable-line(unsafe-cheatcode)
    uint256 length;
    while (vm.keyExistsJson(json, string.concat(".transactions[", length.toString(), "]"))) ++length;
    if (length == 0) revert EmptyBroadcast();
    Call[] memory calls = new Call[](length);
    address safe;
    for (uint256 i = 0; i < length; ++i) {
      string memory prefix = string.concat(".transactions[", i.toString(), "]");
      if (keccak256(bytes(json.readString(string.concat(prefix, ".transactionType")))) != keccak256("CALL")) {
        revert NotACall();
      }
      prefix = string.concat(prefix, ".transaction");
      address from = json.readAddress(string.concat(prefix, ".from"));
      if (i == 0) safe = from;
      else if (from != safe) revert SenderMismatch();
      calls[i] = Call({
        to: json.readAddress(string.concat(prefix, ".to")),
        value: json.readUint(string.concat(prefix, ".value")),
        data: json.readBytes(string.concat(prefix, ".input"))
      });
    }
    if (length == 1) propose(ISafe(safe), calls[0].to, calls[0].value, calls[0].data, 0);
    else proposeBatch(ISafe(safe), calls);
  }

  function proposeBatch(ISafe safe, Call[] memory calls) internal {
    bytes memory packed;
    for (uint256 i = 0; i < calls.length; ++i) {
      packed = abi.encodePacked(packed, uint8(0), calls[i].to, calls[i].value, calls[i].data.length, calls[i].data);
    }
    propose(safe, address(MULTISEND), 0, abi.encodeCall(MULTISEND.multiSend, (packed)), 1);
  }

  function propose(ISafe safe, address to, uint256 value, bytes memory data, uint8 operation) internal virtual {
    string memory hexSafe = address(safe).toHexStringChecksummed();
    string memory url = string.concat(
      "https://api.safe.global/tx-service/", _chainPrefix(), "/api/v2/safes/", hexSafe, "/multisig-transactions/"
    );
    uint256 nonce = safe.nonce();
    bytes32 safeTxHash =
      safe.getTransactionHash(to, value, data, operation, 0, 0, 0, address(0), payable(address(0)), nonce);
    address sender;
    bytes memory signature;
    {
      (uint8 v, bytes32 r, bytes32 s) = vm.sign(safeTxHash);
      sender = ecrecover(safeTxHash, v, r, s);
      signature = abi.encodePacked(r, s, v);
    }
    string[] memory headers = new string[](1);
    headers[0] = "Content-Type: application/json";
    (uint256 status, bytes memory response) =
      url.post(headers, _body(to, value, data, operation, nonce, safeTxHash, sender, signature));
    if (status != 201) revert ProposalFailed(status, string(response));
  }

  // solhint-disable quotes
  function _body(
    address to,
    uint256 value,
    bytes memory data,
    uint8 operation,
    uint256 nonce,
    bytes32 safeTxHash,
    address sender,
    bytes memory signature
  ) internal pure returns (string memory) {
    return string.concat(
      string.concat(
        '{"to":"',
        to.toHexStringChecksummed(),
        '","value":"',
        value.toString(),
        '","data":"',
        data.length == 0 ? "0x" : data.toHexString(),
        '","operation":',
        uint256(operation).toString(),
        ',"safeTxGas":"0","baseGas":"0","gasPrice":"0","gasToken":"',
        address(0).toHexStringChecksummed(),
        '","refundReceiver":"',
        address(0).toHexStringChecksummed()
      ),
      '","nonce":',
      nonce.toString(),
      ',"contractTransactionHash":"',
      bytes.concat(safeTxHash).toHexString(),
      '","sender":"',
      sender.toHexStringChecksummed(),
      '","signature":"',
      signature.toHexString(),
      '"}'
    );
  }
  // solhint-enable quotes

  function _chainPrefix() internal view returns (string memory) {
    if (block.chainid == 1) return "eth";
    if (block.chainid == 10) return "oeth";
    if (block.chainid == 137) return "pol";
    if (block.chainid == 8453) return "base";
    if (block.chainid == 42_161) return "arb1";
    if (block.chainid == 204) return "opbnb";
    revert UnsupportedChain();
  }
}

error EmptyBroadcast();
error NotACall();
error ProposalFailed(uint256 status, string response);
error SenderMismatch();
error UnsupportedChain();

struct Call {
  address to;
  uint256 value;
  bytes data;
}

interface IMultiSendCallOnly {
  function multiSend(bytes memory transactions) external;
}

interface ISafe {
  function nonce() external view returns (uint256);
  function getTransactionHash(
    address to,
    uint256 value,
    bytes calldata data,
    uint8 operation,
    uint256 safeTxGas,
    uint256 baseGas,
    uint256 gasPrice,
    address gasToken,
    address payable refundReceiver,
    uint256 _nonce
  ) external view returns (bytes32);
}
