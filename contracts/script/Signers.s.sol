// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Script } from "forge-std/Script.sol";

contract Signers is Script {
  address internal constant ADMIN = 0xDb90CDB64CfF03f254e4015C4F705C3F3C834400;
  address internal constant TIMELOCK = 0x06Bd0e595f8719027A167f0bb30D40Dd8A785f24;
  address internal constant FIREWALL = 0x01C18E88A4a9ADa7Cce0A10DF56d4a96aB780fc2;
  address internal constant PLUGIN_BASE = 0xb646a97B6CD35fdcAf467E96495603950984F063;
  address internal constant PLUGIN_BASE_OLD = 0x428fDd559dEE0bfA25eed7717f15ac285B3ccd43;
  address internal constant PLUGIN_OP = 0x5B1e61a7802Dc02Bf55435077aC5FF057d06e4AE;
  address internal constant SANDBOX_POKER = 0xafD89CAC1C162bbF6DBFAF0390d159Cf9a01424C;
  address internal constant SANDBOX_ALLOWER = 0x7C9C05B26618c57fDE1f74b9070E94a990365AB4;
  address internal constant BASE_SEPOLIA_POKER = 0x4E4e2c3b7812fcaE2BC83d5355ca3b05B70f0A13;
  bytes32 internal constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
  bytes32 internal constant ALLOWER_ROLE = keccak256("ALLOWER_ROLE");
  uint256 internal constant AMOUNT = 0.05 ether;

  function run() external {
    vm.createSelectFork("base_sepolia");
    vm.startBroadcast(ADMIN);
    grant(PLUGIN_BASE, KEEPER_ROLE, SANDBOX_POKER);
    grant(PLUGIN_BASE_OLD, KEEPER_ROLE, SANDBOX_POKER);
    grant(PLUGIN_BASE_OLD, KEEPER_ROLE, BASE_SEPOLIA_POKER);
    if (!IAccessControl(FIREWALL).hasRole(ALLOWER_ROLE, SANDBOX_ALLOWER)) {
      bytes memory data = abi.encodeCall(IAccessControl.grantRole, (ALLOWER_ROLE, SANDBOX_ALLOWER));
      bytes32 salt = keccak256(abi.encode(SANDBOX_ALLOWER));
      ITimelock(TIMELOCK).schedule(FIREWALL, 0, data, bytes32(0), salt, 0);
      ITimelock(TIMELOCK).execute(FIREWALL, 0, data, bytes32(0), salt);
    }
    fund(SANDBOX_POKER);
    fund(SANDBOX_ALLOWER);
    vm.stopBroadcast();

    vm.createSelectFork("optimism_sepolia");
    vm.startBroadcast(ADMIN);
    grant(PLUGIN_OP, KEEPER_ROLE, BASE_SEPOLIA_POKER);
    fund(SANDBOX_POKER);
    fund(BASE_SEPOLIA_POKER);
    vm.stopBroadcast();
  }

  function grant(address target, bytes32 role, address account) internal {
    if (!IAccessControl(target).hasRole(role, account)) IAccessControl(target).grantRole(role, account);
  }

  function fund(address account) internal {
    if (account.balance < AMOUNT) payable(account).transfer(AMOUNT - account.balance);
  }
}

interface IAccessControl {
  function grantRole(bytes32 role, address account) external;
  function hasRole(bytes32 role, address account) external view returns (bool);
}

interface ITimelock {
  function execute(address target, uint256 value, bytes calldata payload, bytes32 predecessor, bytes32 salt)
    external
    payable;
  function schedule(
    address target,
    uint256 value,
    bytes calldata data,
    bytes32 predecessor,
    bytes32 salt,
    uint256 delay
  ) external;
}
