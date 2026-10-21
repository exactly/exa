// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { IPaymaster, UserOperation } from "modular-account/src/interfaces/erc4337/IPaymaster.sol";

import { ECDSA } from "solady/utils/ECDSA.sol";

contract VerifyingPaymaster is IPaymaster {
  address public immutable SIGNER;

  constructor(address signer) {
    SIGNER = signer;
  }

  function validatePaymasterUserOp(UserOperation calldata userOp, bytes32, uint256)
    external
    view
    returns (bytes memory context, uint256 validationData)
  {
    if (
      SIGNER
        != ECDSA.tryRecoverCalldata(
          ECDSA.toEthSignedMessageHash(
            keccak256(
              abi.encode(
                keccak256(
                  abi.encode(
                    userOp.sender,
                    userOp.nonce,
                    keccak256(userOp.initCode),
                    keccak256(userOp.callData),
                    userOp.callGasLimit,
                    userOp.verificationGasLimit,
                    userOp.preVerificationGas,
                    userOp.maxFeePerGas,
                    userOp.maxPriorityFeePerGas,
                    keccak256(abi.encodePacked(this))
                  )
                ),
                msg.sender,
                block.chainid
              )
            )
          ),
          userOp.paymasterAndData[20:]
        )
    ) validationData = 1;
  }

  function postOp(PostOpMode, bytes calldata, uint256) external { } // solhint-disable-line no-empty-blocks
}
