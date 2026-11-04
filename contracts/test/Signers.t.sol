// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest, stdJson } from "./Fork.t.sol";

import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";

import { IssuerChecker } from "../src/IssuerChecker.sol";

import { ISafe } from "../script/Safe.s.sol";
import { Signers } from "../script/Signers.s.sol";

contract SignersTest is ForkTest {
  using stdJson for string;

  bytes32 internal constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

  SignersHarness internal signers;
  ISafeOwners internal safe;
  IAccessControl internal plugin;
  IAccessControl internal refunder;
  IssuerChecker internal issuerChecker;
  address internal executor;
  address internal settler;
  address internal issuer;

  function setUp() external {
    vm.createSelectFork("optimism", 159_000_000);
    signers = new SignersHarness();
    safe = ISafeOwners(acct("admin"));
    plugin = IAccessControl(broadcast("ExaPlugin"));
    refunder = IAccessControl(broadcast("Refunder"));
    issuerChecker = IssuerChecker(broadcast("IssuerChecker"));

    (address owner, uint256 ownerKey) = makeAddrAndKey("owner");
    vm.rememberKey(ownerKey);
    vm.prank(address(safe));
    safe.addOwnerWithThreshold(owner, 1);
    vm.deal(address(safe), 10 ether);

    executor = makeAddr("executor");
    settler = makeAddr("settler");
    issuer = makeAddr("issuer");
    set("executor", executor);
    set("settler", settler);
    set("issuer", issuer);
    vm.deal(settler, 0.3 ether);
  }

  // solhint-disable func-name-mixedcase
  function test_run_proposesOneMultiSendThatTheSafeExecutes() external {
    string memory body = proposal();

    assertEq(body.readAddress(".to"), 0x9641d764fc13c8B624c04430C7356C1C7C8102e2);
    assertEq(body.readUint(".operation"), 1);
    assertEq(body.readUint(".nonce"), safe.nonce());
    execute(body);
    assertAuthorizedAndFunded();
  }

  function test_run_proposesAfterQueuedTransactions() external {
    signers.queue(safe.nonce() + 2);
    string memory body = proposal();

    assertEq(body.readUint(".nonce"), safe.nonce() + 3);
    assertEq(
      body.readBytes32(".contractTransactionHash"),
      safe.getTransactionHash(
        body.readAddress(".to"),
        0,
        body.readBytes(".data"),
        1,
        0,
        0,
        0,
        address(0),
        payable(address(0)),
        safe.nonce() + 3
      )
    );
  }

  function test_run_proposesSingleCallWithoutMultiSend() external {
    vm.startPrank(address(safe));
    plugin.grantRole(KEEPER_ROLE, executor);
    plugin.grantRole(KEEPER_ROLE, settler);
    refunder.grantRole(KEEPER_ROLE, settler);
    issuerChecker.setIssuer(issuer);
    vm.stopPrank();
    vm.deal(executor, 1 ether);
    vm.deal(settler, 1 ether);
    set("issuer", makeAddr("next issuer"));

    string memory body = proposal();

    assertEq(body.readAddress(".to"), address(issuerChecker));
    assertEq(body.readUint(".operation"), 0);
    assertEq(body.readBytes(".data"), abi.encodeCall(IssuerChecker.setIssuer, (makeAddr("next issuer"))));
    execute(body);
    assertEq(issuerChecker.issuer(), makeAddr("next issuer"));
  }

  function test_run_skipsProposalWhenNothingChanges() external {
    execute(proposal());

    signers.run(1 ether);

    assertEq(signers.body(), "");
  }

  function test_run_broadcastsWhenAdminIsAnAccount() external {
    address admin = makeAddr("admin");
    vm.startPrank(address(safe));
    plugin.grantRole(bytes32(0), admin);
    refunder.grantRole(bytes32(0), admin);
    IAccessControl(address(issuerChecker)).grantRole(bytes32(0), admin);
    vm.stopPrank();
    vm.deal(admin, 10 ether);
    set("admin", admin);

    signers.run(1 ether);

    assertEq(signers.body(), "");
    assertAuthorizedAndFunded();
  }
  // solhint-enable func-name-mixedcase

  function proposal() internal returns (string memory body) {
    uint256 snapshot = vm.snapshotState();
    signers.run(1 ether);
    body = signers.body();
    vm.revertToState(snapshot);
  }

  function execute(string memory body) internal {
    assertTrue(
      safe.execTransaction(
        body.readAddress(".to"),
        body.readUint(".value"),
        body.readBytes(".data"),
        uint8(body.readUint(".operation")),
        0,
        0,
        0,
        address(0),
        payable(address(0)),
        body.readBytes(".signature")
      )
    );
  }

  function assertAuthorizedAndFunded() internal view {
    assertTrue(plugin.hasRole(KEEPER_ROLE, executor));
    assertTrue(plugin.hasRole(KEEPER_ROLE, settler));
    assertTrue(refunder.hasRole(KEEPER_ROLE, settler));
    assertEq(issuerChecker.issuer(), issuer);
    assertEq(executor.balance, 1 ether);
    assertEq(settler.balance, 1 ether);
  }
}

contract SignersHarness is Signers {
  string public body;
  uint256 internal queued;

  function queue(uint256 nonce) external {
    queued = nonce;
  }

  function request(string memory, string memory body_) internal override returns (uint256, bytes memory) {
    if (bytes(body_).length != 0) {
      body = body_;
      return (201, "");
    }
    if (queued == 0) return (200, '{"count":0,"next":null,"previous":null,"results":[]}'); // solhint-disable-line quotes
    return (200, bytes(string.concat('{"count":1,"results":[{"nonce":', vm.toString(queued), "}]}"))); // solhint-disable-line quotes
  }
}

interface ISafeOwners is ISafe {
  function addOwnerWithThreshold(address owner, uint256 threshold) external;
  function execTransaction(
    address to,
    uint256 value,
    bytes calldata data,
    uint8 operation,
    uint256 safeTxGas,
    uint256 baseGas,
    uint256 gasPrice,
    address gasToken,
    address payable refundReceiver,
    bytes memory signatures
  ) external payable returns (bool);
}
