// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Vm, VmSafe } from "forge-std/Vm.sol";

import { LibString } from "solady/utils/LibString.sol";
import { Surl } from "surl/Surl.sol";

import { BaseScript, stdJson } from "./Base.s.sol";

abstract contract SafeScript is BaseScript {
  using LibString for address;
  using LibString for uint256;
  using stdJson for string;
  using Surl for string;

  IMultiSendCallOnly internal constant MULTI_SEND = IMultiSendCallOnly(0x9641d764fc13c8B624c04430C7356C1C7C8102e2); // github.com/safe-global/safe-deployments v1.4.1

  /// @dev runs the body as `account`: broadcasts when it is an eoa (eip-7702 delegated or not),
  /// proposes the calls it makes as one safe transaction otherwise.
  modifier through(address account) {
    bytes memory code = account.code;
    // forge-lint: disable-next-line(unsafe-typecast)
    if (code.length == 0 || bytes3(code) == 0xef0100) {
      vm.startBroadcast(account);
      _;
      vm.stopBroadcast();
      return;
    }
    vm.startStateDiffRecording();
    vm.startPrank(account);
    _;
    vm.stopPrank();
    propose(ISafe(account), vm.stopAndReturnStateDiff());
  }

  function propose(ISafe safe, Vm.AccountAccess[] memory accesses) internal {
    uint256 length;
    for (uint256 i = 0; i < accesses.length; ++i) {
      if (!isCall(safe, accesses[i])) continue;
      accesses[length] = accesses[i];
      ++length;
    }
    if (length == 0) return;

    address to = accesses[0].account;
    uint256 value = accesses[0].value;
    bytes memory data = accesses[0].data;
    uint8 operation = 0;
    if (length > 1) {
      bytes memory packed;
      for (uint256 i = 0; i < length; ++i) {
        packed = abi.encodePacked(
          packed, uint8(0), accesses[i].account, accesses[i].value, accesses[i].data.length, accesses[i].data
        );
      }
      (to, value, data, operation) = (address(MULTI_SEND), 0, abi.encodeCall(MULTI_SEND.multiSend, (packed)), 1);
    }

    string memory url = string.concat(
      "https://api.safe.global/tx-service/",
      shortName(),
      "/api/v2/safes/",
      address(safe).toHexStringChecksummed(),
      "/multisig-transactions/"
    );
    uint256 nonce = nextNonce(safe, url);
    bytes32 safeTxHash =
      safe.getTransactionHash(to, value, data, operation, 0, 0, 0, address(0), payable(address(0)), nonce);
    (address sender, bytes memory signature) = sign(safe, safeTxHash);

    string memory json = "proposal";
    json.serialize("to", to.toHexStringChecksummed());
    json.serialize("value", value.toString());
    json.serialize("data", data);
    json.serialize("operation", uint256(operation));
    json.serialize("safeTxGas", string("0"));
    json.serialize("baseGas", string("0"));
    json.serialize("gasPrice", string("0"));
    json.serialize("gasToken", address(0).toHexStringChecksummed());
    json.serialize("refundReceiver", address(0).toHexStringChecksummed());
    json.serialize("nonce", nonce.toString());
    json.serialize("contractTransactionHash", safeTxHash);
    json.serialize("sender", sender.toHexStringChecksummed());
    (uint256 status, bytes memory response) = request(url, json.serialize("signature", signature));
    if (status != 201) revert ProposalFailed(status, string(response));
  }

  function isCall(ISafe safe, Vm.AccountAccess memory access) internal pure returns (bool) {
    return access.kind == VmSafe.AccountAccessKind.Call && access.accessor == address(safe) && !access.reverted;
  }

  function nextNonce(ISafe safe, string memory url) internal returns (uint256 nonce) {
    nonce = safe.nonce();
    (uint256 status, bytes memory response) =
      request(string.concat(url, "?executed=false&ordering=-nonce&limit=1&nonce__gte=", nonce.toString()), "");
    if (status != 200) revert ProposalFailed(status, string(response));
    if (vm.keyExistsJson(string(response), ".results[0]")) {
      nonce = string(response).readUint(".results[0].nonce") + 1;
    }
  }

  function sign(ISafe safe, bytes32 safeTxHash) internal view returns (address sender, bytes memory signature) {
    address[] memory wallets = vm.getWallets();
    for (uint256 i = 0; i < wallets.length; ++i) {
      if (!safe.isOwner(wallets[i])) continue;
      (uint8 v, bytes32 r, bytes32 s) = vm.sign(wallets[i], safeTxHash);
      return (wallets[i], abi.encodePacked(r, s, v));
    }
    revert NoOwner();
  }

  /// @dev gets `url` when `body` is empty, posts `body` to it otherwise.
  function request(string memory url, string memory body)
    internal
    virtual
    returns (uint256 status, bytes memory response)
  {
    string[] memory headers = new string[](2);
    headers[0] = "Content-Type: application/json";
    headers[1] = string.concat("Authorization: Bearer ", vm.envString("SAFE_API_KEY"));
    return bytes(body).length == 0 ? url.get(headers) : url.post(headers, body);
  }

  function shortName() internal view returns (string memory) {
    if (block.chainid == 10) return "oeth"; // cspell:ignore oeth
    if (block.chainid == 8453) return "base";
    revert UnsupportedChain();
  }
}

error NoOwner();
error ProposalFailed(uint256 status, string response);
error UnsupportedChain();

interface IMultiSendCallOnly {
  function multiSend(bytes memory transactions) external payable;
}

interface ISafe {
  function nonce() external view returns (uint256);
  function isOwner(address owner) external view returns (bool);
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
    uint256 nonce
  ) external view returns (bytes32);
}
