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

  IMultiSendCallOnly internal constant MULTI_SEND = IMultiSendCallOnly(0x9641d764fc13c8B624c04430C7356C1C7C8102e2);

  modifier through(address account) {
    {
      bytes memory code = account.code;
      // forge-lint: disable-next-line(unsafe-typecast)
      if (code.length == 0 || bytes3(code) == 0xef0100) {
        vm.startBroadcast(account);
        _;
        vm.stopBroadcast();
        return;
      }
    }
    vm.startStateDiffRecording();
    vm.startPrank(account);
    _;
    vm.stopPrank();

    address to;
    uint256 value;
    bytes memory data;
    uint8 operation;
    {
      Vm.AccountAccess[] memory calls = vm.stopAndReturnStateDiff();
      bytes memory packed;
      uint256 length = 0;
      for (uint256 i = 0; i < calls.length; ++i) {
        if (calls[i].kind != VmSafe.AccountAccessKind.Call || calls[i].accessor != account || calls[i].reverted) {
          continue;
        }
        packed =
          abi.encodePacked(packed, uint8(0), calls[i].account, calls[i].value, calls[i].data.length, calls[i].data);
        calls[length] = calls[i];
        ++length;
      }
      if (length == 0) return;
      (to, value, data, operation) = length == 1
        ? (calls[0].account, calls[0].value, calls[0].data, 0)
        : (address(MULTI_SEND), 0, abi.encodeCall(MULTI_SEND.multiSend, (packed)), 1);
    }

    string memory url;
    {
      string memory shortName;
      if (block.chainid == 10) shortName = "oeth"; // cspell:ignore oeth
      else if (block.chainid == 8453) shortName = "base";
      else revert UnsupportedChain();
      url = string.concat(
        "https://api.safe.global/tx-service/",
        shortName,
        "/api/v2/safes/",
        account.toHexStringChecksummed(),
        "/multisig-transactions/"
      );
    }

    uint256 nonce = ISafe(account).nonce();
    {
      (uint256 status, bytes memory response) =
        request(string.concat(url, "?executed=false&ordering=-nonce&limit=1&nonce__gte=", nonce.toString()), "");
      if (status != 200) revert ProposalFailed(status, string(response));
      if (vm.keyExistsJson(string(response), ".results[0]")) {
        nonce = string(response).readUint(".results[0].nonce") + 1;
      }
    }

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
    bytes32 safeTxHash =
      ISafe(account).getTransactionHash(to, value, data, operation, 0, 0, 0, address(0), payable(address(0)), nonce);
    json.serialize("contractTransactionHash", safeTxHash);
    {
      address[] memory wallets = vm.getWallets();
      uint256 owner = 0;
      while (owner < wallets.length && !ISafe(account).isOwner(wallets[owner])) ++owner;
      if (owner == wallets.length) revert NoOwner();
      json.serialize("sender", wallets[owner].toHexStringChecksummed());
      (uint8 v, bytes32 r, bytes32 s) = vm.sign(wallets[owner], safeTxHash);
      json = json.serialize("signature", abi.encodePacked(r, s, v));
    }
    {
      (uint256 status, bytes memory response) = request(url, json);
      if (status != 201) revert ProposalFailed(status, string(response));
    }
  }

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
