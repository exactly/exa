// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Test, stdError, stdJson } from "forge-std/Test.sol"; // solhint-disable-line no-unused-import
import { Vm } from "forge-std/Vm.sol"; // solhint-disable-line no-unused-import

import { LibString } from "solady/utils/LibString.sol";

abstract contract ForkTest is Test {
  using LibString for address;
  using LibString for uint256;
  using LibString for string;
  using LibString for bytes;
  using stdJson for string;

  ICreate3Factory internal immutable CREATE3_FACTORY;

  constructor() {
    // TODO remove after https://github.com/lifinance/create3-factory/issues/14
    if (block.chainid == 11_155_420) CREATE3_FACTORY = ICreate3Factory(0xcc3f41204a1324DD91F1Dbfc46208535293A371e);
    // TODO remove after https://github.com/lifinance/create3-factory/issues/18
    else if (block.chainid == 84_532) CREATE3_FACTORY = ICreate3Factory(0x9f275F6D25232FFf082082a53C62C6426c1cc94C);
    else CREATE3_FACTORY = ICreate3Factory(0x93FEC2C00BfE902F733B57c5a6CeeD7CD1384AE1);
    vm.label(address(CREATE3_FACTORY), "CREATE3Factory");
    if (block.chainid == getChain("anvil").chainId) etchCreate3();
  }

  function etchCreate3() internal {
    bytes memory code =
      hex"6080604052600436106100295760003560e01c806350f1c4641461002e578063cdcb760a14610077575b600080fd5b34801561003a57600080fd5b5061004e610049366004610489565b61008a565b60405173ffffffffffffffffffffffffffffffffffffffff909116815260200160405180910390f35b61004e6100853660046104fd565b6100ee565b6040517fffffffffffffffffffffffffffffffffffffffff000000000000000000000000606084901b166020820152603481018290526000906054016040516020818303038152906040528051906020012091506100e78261014c565b9392505050565b6040517fffffffffffffffffffffffffffffffffffffffff0000000000000000000000003360601b166020820152603481018390526000906054016040516020818303038152906040528051906020012092506100e78383346102b2565b604080518082018252601081527f67363d3d37363d34f03d5260086018f30000000000000000000000000000000060209182015290517fff00000000000000000000000000000000000000000000000000000000000000918101919091527fffffffffffffffffffffffffffffffffffffffff0000000000000000000000003060601b166021820152603581018290527f21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f60558201526000908190610228906075015b6040516020818303038152906040528051906020012090565b6040517fd69400000000000000000000000000000000000000000000000000000000000060208201527fffffffffffffffffffffffffffffffffffffffff000000000000000000000000606083901b1660228201527f010000000000000000000000000000000000000000000000000000000000000060368201529091506100e79060370161020f565b6000806040518060400160405280601081526020017f67363d3d37363d34f03d5260086018f30000000000000000000000000000000081525090506000858251602084016000f5905073ffffffffffffffffffffffffffffffffffffffff811661037d576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601160248201527f4445504c4f594d454e545f4641494c454400000000000000000000000000000060448201526064015b60405180910390fd5b6103868661014c565b925060008173ffffffffffffffffffffffffffffffffffffffff1685876040516103b091906105d6565b60006040518083038185875af1925050503d80600081146103ed576040519150601f19603f3d011682016040523d82523d6000602084013e6103f2565b606091505b50509050808015610419575073ffffffffffffffffffffffffffffffffffffffff84163b15155b61047f576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601560248201527f494e495449414c495a4154494f4e5f4641494c454400000000000000000000006044820152606401610374565b5050509392505050565b6000806040838503121561049c57600080fd5b823573ffffffffffffffffffffffffffffffffffffffff811681146104c057600080fd5b946020939093013593505050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b6000806040838503121561051057600080fd5b82359150602083013567ffffffffffffffff8082111561052f57600080fd5b818501915085601f83011261054357600080fd5b813581811115610555576105556104ce565b604051601f82017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0908116603f0116810190838211818310171561059b5761059b6104ce565b816040528281528860208487010111156105b457600080fd5b8260208601602083013760006020848301015280955050505050509250929050565b6000825160005b818110156105f757602081860181015185830152016105dd565b50600092019182525091905056fea26469706673582212201ff95c2aafa102481fdd22c59ee7f98a92a9662a6566ab5e0498e8bb47a5f30c64736f6c63430008110033";
    vm.etch(address(CREATE3_FACTORY), code);
    try vm.activeFork() {
      vm.rpc(
        "anvil_setCode",
        string.concat('["', address(CREATE3_FACTORY).toHexString(), '","', code.toHexString(), '"]') // solhint-disable-line quotes
      );
    } catch { } // solhint-disable-line no-empty-blocks
  }

  function set(string memory name, address addr) internal {
    vm.store(address(this), keccak256(abi.encode(name)), bytes32(uint256(uint160(addr))));
  }

  function unset(string memory name) internal {
    vm.store(address(this), keccak256(abi.encode(name)), 0);
  }

  function acct(string memory name) internal returns (address addr) {
    addr = address(uint160(uint256(vm.load(msg.sender, keccak256(abi.encode(name))))));
    if (addr == address(0)) addr = vm.envOr(string.concat(name.upper(), "_ADDRESS"), address(0));
    if (addr == address(0)) {
      string memory deploy = vm.readFile("deploy.json");
      string memory key = string.concat(".accounts.", name, ".", block.chainid.toString());
      addr = deploy.keyExists(key)
        ? deploy.readAddress(key)
        : deploy.readAddress(string.concat(".accounts.", name, ".default"));
    }
    _label(addr, name);
  }

  function protocol(string memory name) internal returns (address addr) {
    return protocol(name, true);
  }

  function protocol(string memory name, bool required) internal returns (address addr) {
    addr = address(uint160(uint256(vm.load(msg.sender, keccak256(abi.encode(name))))));
    if (addr == address(0)) addr = vm.envOr(string.concat("PROTOCOL_", name.upper(), "_ADDRESS"), address(0));
    if (addr == address(0)) {
      try vm.readFile(
        string.concat(
          "node_modules/@exactly/protocol/deployments/",
          block.chainid == 11_155_420 ? "op-sepolia" : getChain(block.chainid).chainAlias.replace("_", "-"),
          "/",
          name,
          ".json"
        )
      ) returns (string memory json) {
        addr = json.readAddress(".address");
      } catch { } // solhint-disable-line no-empty-blocks
    }
    if (addr != address(0)) _label(addr, name);
    else if (required) revert(string.concat(name, " not found"));
  }

  function broadcast(string memory name) internal returns (address) {
    return broadcast(name, name, 0);
  }

  function broadcast(string memory name, string memory script, uint256 index) internal returns (address) {
    return _broadcast(name, string.concat("broadcast/", script), index);
  }

  function dependency(string memory package, string memory name, string memory script, uint256 index)
    internal
    returns (address)
  {
    return _broadcast(name, string.concat("node_modules/", package, "/broadcast/", script), index);
  }

  function _broadcast(string memory name, string memory script, uint256 index) private returns (address addr) {
    addr = address(uint160(uint256(vm.load(msg.sender, keccak256(abi.encode(name))))));
    if (addr == address(0)) addr = vm.envOr(string.concat("BROADCAST_", name.upper(), "_ADDRESS"), address(0));
    if (addr == address(0)) {
      addr = vm.readFile(string.concat(script, ".s.sol/", block.chainid.toString(), "/run-latest.json")).readAddress(
        string.concat(".transactions[", index.toString(), "].contractAddress")
      );
    }
    _label(addr, name);
  }

  function _label(address addr, string memory name) private {
    vm.label(addr, name);

    address impl =
      address(uint160(uint256(vm.load(addr, bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)))));
    if (impl == address(0)) {
      impl = address(uint160(uint256(vm.load(addr, keccak256("org.zeppelinos.proxy.implementation")))));
    }
    if (impl != address(0)) {
      vm.label(impl, string.concat(name, "_Impl"));
    } else if (bytes10(addr.code) == 0x363d3d373d3d3d363d73) {
      vm.label(address(uint160(uint240(bytes30(addr.code)))), string.concat(name, "_Impl"));
    }
  }
}

interface ICreate3Factory {
  /// @notice Deploys a contract using CREATE3
  /// @dev The provided salt is hashed together with msg.sender to generate the final salt
  /// @param salt The deployer-specific salt for determining the deployed contract's address
  /// @param creationCode The creation code of the contract to deploy
  /// @return deployed The address of the deployed contract
  function deploy(bytes32 salt, bytes memory creationCode) external payable returns (address deployed);

  /// @notice Predicts the address of a deployed contract
  /// @dev The provided salt is hashed together with the deployer address to generate the final salt
  /// @param deployer The deployer account that will call deploy()
  /// @param salt The deployer-specific salt for determining the deployed contract's address
  /// @return deployed The address of the contract that will be deployed
  function getDeployed(address deployer, bytes32 salt) external view returns (address deployed);
}
