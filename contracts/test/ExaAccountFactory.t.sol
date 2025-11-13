// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0; // solhint-disable-line one-contract-per-file

import { ForkTest } from "./Fork.t.sol";

import { EntryPoint } from "account-abstraction/core/EntryPoint.sol";

import { UpgradeableModularAccount } from "modular-account/src/account/UpgradeableModularAccount.sol";

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { ERC20 } from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC4626.sol";

import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";
import { MAX_OWNERS } from "webauthn-owner-plugin/IWebauthnOwnerPlugin.sol";
import { OwnersLib } from "webauthn-owner-plugin/OwnersLib.sol";
import { WebauthnOwnerPlugin } from "webauthn-owner-plugin/WebauthnOwnerPlugin.sol";

import { DeployExaAccountFactory } from "../script/ExaAccountFactory.s.sol";
import { DeployExaPlugin } from "../script/ExaPlugin.s.sol";
import { ExaAccountFactory, ExaAccountInitialized } from "../src/ExaAccountFactory.sol";

contract ExaAccountFactoryTest is ForkTest {
  using FixedPointMathLib for uint256;
  using OwnersLib for address[];

  ExaAccountFactory internal factory;
  WebauthnOwnerPlugin internal ownerPlugin;
  address internal exaPlugin;

  function setUp() external {
    ownerPlugin = new WebauthnOwnerPlugin();
    vm.etch(address(ENTRYPOINT), address(new EntryPoint()).code);
    vm.etch(ACCOUNT_IMPL, address(new UpgradeableModularAccount(ENTRYPOINT)).code);

    set("admin", address(this));
    set("deployer", address(this));
    set("Auditor", address(this));
    set("MarketUSDC", address(new MockERC4626(new MockERC20())));
    set("MarketWETH", address(new MockERC4626(new MockERC20())));
    set("Balancer2Vault", address(this));
    set("DebtManager", address(this));
    set("InstallmentsRouter", address(this));
    set("IssuerChecker", address(this));
    set("ProposalManager", address(new MockAccessControl()));
    set("WebauthnOwnerPlugin", address(ownerPlugin));

    DeployExaPlugin p = new DeployExaPlugin();
    p.run();
    exaPlugin = address(p.exaPlugin());
    set("ExaPlugin", exaPlugin);

    DeployExaAccountFactory f = new DeployExaAccountFactory();
    f.run();
    factory = f.factory();
  }

  // solhint-disable func-name-mixedcase

  function testFuzz_createAccount_EOAOwners(uint256 salt, address[MAX_OWNERS - 1] calldata rawOwners) external {
    // bound length
    address[] memory owners = new address[](_bound(salt, 1, rawOwners.length));
    for (uint256 i = 0; i < owners.length; ++i) {
      vm.assume(rawOwners[i] != address(0) && rawOwners[i] != address(factory));
      owners[i] = rawOwners[i];
    }

    // sort
    for (uint256 i = 0; i < owners.length; ++i) {
      uint256 j = i;
      while (j > 0 && owners[j - 1] > owners[j]) {
        (owners[j - 1], owners[j]) = (owners[j], owners[j - 1]);
        --j;
      }
    }

    for (uint256 i = 0; i < owners.length - 1; ++i) {
      vm.assume(owners[i] != owners[i + 1]); // unique
    }

    vm.expectEmit(true, true, true, true, address(factory));
    emit ExaAccountInitialized(factory.getAddress(salt, owners.toPublicKeys()));

    address account = factory.createAccount(salt, owners.toPublicKeys());

    address[] memory actualOwners = ownerPlugin.ownersOf(account);
    assertEq(actualOwners.length, owners.length);
    assertFalse(ownerPlugin.isOwnerOf(account, address(factory)));
    for (uint256 i = 0; i < owners.length; ++i) {
      ownerPlugin.isOwnerOf(account, owners[i]);
    }
  }

  function test_deploy_deploysToSameAddress() external {
    address[] memory owners = new address[](1);
    owners[0] = address(this);
    address account = factory.createAccount(0, owners.toPublicKeys());
    bytes memory pluginCode = address(exaPlugin).code;

    vm.createSelectFork("optimism", 127_050_624);

    set("ProposalManager", address(new MockAccessControl()));
    unset("WebauthnOwnerPlugin");
    vm.etch(address(exaPlugin), pluginCode);
    DeployExaAccountFactory f = new DeployExaAccountFactory();
    f.run();

    assertEq(address(f.factory()), address(factory), "different factory address");
    assertEq(factory.getAddress(0, owners.toPublicKeys()), account, "different account address");
  }

  // solhint-enable func-name-mixedcase

  function _sorted(address[] memory owners) internal pure returns (address[] memory) {
    return owners;
  }
}

contract MockERC4626 is ERC4626 {
  constructor(ERC20 token) ERC20("", "") ERC4626(token) { }
}

contract MockERC20 is ERC20 {
  constructor() ERC20("", "") { }
}

contract MockAccessControl is AccessControl {
  constructor() {
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
  }
}
