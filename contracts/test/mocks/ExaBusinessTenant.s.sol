// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { AccessManager } from "openzeppelin-contracts/contracts/access/manager/AccessManager.sol";

import { BaseScript, stdJson } from "../../script/Base.s.sol";

contract DeployExaBusinessTenant is BaseScript {
  using stdJson for string;

  function run() external returns (AccessManager manager) {
    vm.broadcast(acct("deployer"));
    manager = AccessManager(
      CREATEX.deployCreate3(_salt(), abi.encodePacked(type(AccessManager).creationCode, abi.encode(acct("admin"))))
    );

    if (block.chainid == getChain("anvil").chainId) return manager;

    address safe = vm.readFile("deploy.json").readAddress(".accounts.admin.default");
    bytes memory data = abi.encodeCall(ISafe.getOwners, ());
    address[] memory owners = abi.decode(
      vm.rpc(
        "optimism",
        "eth_call",
        string.concat('[{"to":"', vm.toString(safe), '","data":"', vm.toString(data), '"},"latest"]') // solhint-disable-line quotes
      ),
      (address[])
    );

    bytes[] memory calls = new bytes[](owners.length);
    for (uint256 i = 0; i < owners.length; ++i) {
      calls[i] = abi.encodeCall(AccessManager.grantRole, (manager.ADMIN_ROLE(), owners[i], 0));
    }

    vm.broadcast(acct("admin"));
    manager.multicall(calls);
  }

  function _salt() internal returns (bytes32) {
    return bytes32(abi.encodePacked(acct("deployer"), bytes1(0), keccak256(abi.encode("ExaBusinessTenant"))));
  }

  function getAddress() external returns (address) {
    etchCanonical();
    return CREATEX.computeCreate3Address(keccak256(abi.encode(acct("deployer"), _salt())));
  }
}

interface ISafe {
  function getOwners() external view returns (address[] memory);
}
