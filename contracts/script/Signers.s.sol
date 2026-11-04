// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

import { IssuerChecker } from "../src/IssuerChecker.sol";

import { SafeScript } from "./Safe.s.sol";

contract Signers is SafeScript {
  bytes32 internal constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

  function run(uint256 balance) external through(acct("admin")) {
    address executor = acct("executor");
    address settler = acct("settler");

    grant(IAccessControl(broadcast("ExaPlugin")), KEEPER_ROLE, executor);
    grant(IAccessControl(broadcast("ExaPlugin")), KEEPER_ROLE, settler);
    grant(IAccessControl(broadcast("Refunder")), KEEPER_ROLE, settler);

    IssuerChecker issuerChecker = IssuerChecker(broadcast("IssuerChecker"));
    address issuer = acct("issuer");
    if (issuerChecker.issuer() != issuer) issuerChecker.setIssuer(issuer);

    fund(executor, balance);
    fund(settler, balance);
  }

  function grant(IAccessControl target, bytes32 role, address account) internal {
    if (!target.hasRole(role, account)) target.grantRole(role, account);
  }

  function fund(address account, uint256 balance) internal {
    if (account.balance < balance) SafeTransferLib.safeTransferETH(account, balance - account.balance);
  }
}
