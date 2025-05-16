import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { cose, decodeCredentialPublicKey, isoBase64URL } from "@simplewebauthn/server/helpers";
import {
  bytesToHex,
  checksumAddress,
  encodeAbiParameters,
  encodePacked,
  isHash,
  keccak256,
  padHex,
  recoverTypedDataAddress,
  slice,
  verifyMessage,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { optimism, optimismSepolia } from "viem/chains";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";

// #region environment configuration
const { chain, domain, androidFingerprints, verifyingContract } = {
  // production
  [optimism.id]: {
    chain: optimism,
    domain: "web.exactly.app",
    verifyingContract: "0x59A644E490E48235adF8ba9b814A4f666C4fEb3A",
    androidFingerprints: [
      "38:12:6D:6C:E8:0C:E0:75:D9:EF:F5:3B:16:A9:F2:E7:CA:9E:11:1D:54:70:30:CA:99:C6:08:83:D2:A7:E8:85", // google
      "9C:4C:A3:27:B8:F1:97:92:8A:A0:02:D6:82:EC:9E:10:EE:8F:D6:03:A1:A6:91:C0:C6:71:77:70:1E:F5:AC:11", // expo
    ],
  } as const,
  // sandbox
  [optimismSepolia.id]: {
    chain: optimismSepolia,
    domain: "sandbox.exactly.app",
    verifyingContract: "0xEEA2dFc3186C348B59F8D62bb6D6BB6f27499A35",
    androidFingerprints: [
      "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C", // debug
    ],
  } as const,
}[process.env.NODE_ENV === "production" ? optimism.id : optimismSepolia.id];
// #endregion

// #region account association
/**
 * Retrieves or derives an account address based on the provided authentication method.
 * It verifies the authentication details (either SIWE or WebAuthn) and ensures
 * the statement correctly authorizes the account association with the given card's last 4 digits.
 *
 * @param last4 - The last four digits of the card to be associated.
 * @param authentication - The user-provided authentication details. This object's structure depends on the `method`:
 *   - If `method` is "siwe" (Sign-in With Ethereum), it requires:
 *     - `factory` ({@link Address}): The factory address.
 *     - `message` (string): The SIWE message text.
 *     - `signature` ({@link Hex}): The signature of the SIWE message.
 *   - If `method` is "webauthn", it requires:
 *     - `factory` ({@link Address}): The factory address.
 *     - `challenge` (string): The server-generated challenge that was signed.
 *     - `credential` ({@link WebAuthnCredential}): The WebAuthn credential information.
 *     - `assertion` ({@link AuthenticationResponseJSON}): The authentication assertion from the WebAuthn API.
 * @returns A promise that resolves to the derived account address ({@link Address}).
 * @throws Throws an error if the authentication is invalid or the statement is malformed/incorrect.
 */
async function getAccount(
  last4: string,
  authentication:
    | { method: "siwe"; factory: Address; message: string; signature: Hex }
    | {
        method: "webauthn";
        factory: Address;
        challenge: string;
        credential: WebAuthnCredential;
        assertion: AuthenticationResponseJSON;
      },
) {
  let x, y: Address;
  let statement: string;
  switch (authentication.method) {
    case "siwe": {
      const { message, signature } = authentication;
      const siwe = parseSiweMessage(message);
      if (
        !siwe.address ||
        !siwe.statement ||
        !validateSiweMessage({ message: siwe, domain, scheme: "https" }) ||
        !(await verifyMessage({ address: siwe.address, message, signature }))
      ) {
        throw new Error("bad authentication");
      }
      x = padHex(siwe.address, { size: 32, dir: "left" });
      y = zeroHash;
      statement = siwe.statement;
      break;
    }
    case "webauthn": {
      const { challenge, credential, assertion } = authentication;
      const { verified, authenticationInfo } = await verifyAuthenticationResponse({
        response: assertion,
        expectedRPID: domain,
        expectedOrigin: [
          `https://${domain}`,
          ...androidFingerprints.map(
            (fingerprint) =>
              `android:apk-key-hash:${isoBase64URL.fromBuffer(Buffer.from(fingerprint.replaceAll(":", ""), "hex"))}`,
          ),
        ],
        expectedChallenge: challenge,
        credential: {
          id: assertion.id,
          publicKey: credential.publicKey,
          transports: credential.transports,
          counter: credential.counter,
        },
      });
      if (!verified || authenticationInfo.credentialID !== assertion.id) throw new Error("bad authentication");
      ({ x, y } = decodePublicKey(credential.publicKey));
      statement = isoBase64URL.toUTF8String(challenge);
      break;
    }
  }
  const match =
    /^I authorize account (?<account>0x[0-9a-fA-F]{40}) to be associated with the card ending in (?<last4>\d{4}).$/.exec(
      statement,
    );
  const account = deriveAddress(authentication.factory, { x, y });
  if (
    !match?.groups?.account ||
    !match.groups.last4 ||
    match.groups.account !== account ||
    match.groups.last4 !== last4
  ) {
    throw new Error("bad statement");
  }
  return account;
}
// #endregion

// #region transaction signing
const issuer = process.env.ISSUER_MNEMONIC
  ? mnemonicToAccount(process.env.ISSUER_MNEMONIC)
  : process.env.ISSUER_PRIVATE_KEY && isHash(process.env.ISSUER_PRIVATE_KEY)
    ? privateKeyToAccount(process.env.ISSUER_PRIVATE_KEY)
    : mnemonicToAccount("test test test test test test test test test test test junk"); // TODO throw error

/**
 * Signs an issuer operation (Collection or Refund) using the issuer's private key.
 *
 * @param params - The parameters for the issuer operation.
 * @param params.account - The account address for the operation.
 * @param params.amount - The amount for the operation in USDC, as a bigint with 6 decimal places
 *   (e.g., 1_000_000n for 1 USDC). Positive for Collection, negative for Refund.
 * @param params.timestamp - The timestamp (in seconds since the Unix epoch) of the specific transaction that this
 *   signature is being generated for. This helps prevent replay attacks by ensuring the signature is tied to a unique
 *   transactional event.
 * @returns A promise that resolves to the signature of the typed data.
 */
export function signIssuerOp({ account, amount, timestamp }: { account: Address; amount: bigint; timestamp: number }) {
  return issuer.signTypedData({
    domain: { chainId: chain.id, name: "IssuerChecker", version: "1", verifyingContract },
    types: {
      Collection: [
        { name: "account", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "timestamp", type: "uint40" },
      ],
      Refund: [
        { name: "account", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "timestamp", type: "uint40" },
      ],
    },
    primaryType: amount < 0n ? "Refund" : "Collection",
    message: { account, amount: amount < 0n ? -amount : amount, timestamp },
  });
}
// #endregion

// #region account association helpers
/**
 * Decodes a COSE public key in EC2 format.
 *
 * @param bytes - The public key as a Uint8Array.
 * @returns An object containing the x and y coordinates of the public key as hex strings.
 * @throws Throws an error if the public key is not in the expected COSE EC2 format or if x/y coordinates are missing.
 */
function decodePublicKey(bytes: Uint8Array) {
  const publicKey = decodeCredentialPublicKey(bytes);
  if (!cose.isCOSEPublicKeyEC2(publicKey)) throw new Error("bad public key");

  const x = publicKey.get(cose.COSEKEYS.x);
  const y = publicKey.get(cose.COSEKEYS.y);
  if (!x || !y) throw new Error("bad public key");

  return { x: bytesToHex(x), y: bytesToHex(y) };
}

/**
 * Derives a contract address based on a factory address and a public key's x and y coordinates.
 * This function computes a checksummed address using a specific derivation scheme involving keccak256 hashing
 * and encoding of parameters.
 *
 * @param factory - The factory address.
 * @param coordinates - An object containing the x and y coordinates of a public key.
 * @param coordinates.x - The x-coordinate as an {@link Address} (bytes32 hex string).
 * @param coordinates.y - The y-coordinate as an {@link Address} (bytes32 hex string).
 * @returns The derived and checksummed contract address ({@link Address}).
 */
export default function deriveAddress(factory: Address, { x, y }: { x: Address; y: Address }) {
  return checksumAddress(
    slice(
      keccak256(
        encodePacked(
          ["uint8", "address", "bytes32", "bytes32"],
          [
            0xff,
            factory,
            keccak256(
              encodeAbiParameters(
                [{ type: "uint256" }, { type: "bytes" }],
                [
                  0n,
                  encodeAbiParameters(
                    [
                      {
                        type: "tuple[]",
                        components: [
                          { name: "x", type: "bytes32" },
                          { name: "y", type: "bytes32" },
                        ],
                      },
                    ],
                    [[{ x, y }]],
                  ),
                ],
              ),
            ),
            keccak256(
              encodePacked(
                ["bytes", "address", "bytes"],
                [
                  "0x603d3d8160223d3973",
                  "0x0046000000000151008789797b54fdb500E2a61e", // account implementation
                  "0x60095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3",
                ],
              ),
            ),
          ],
        ),
      ),
      12,
    ),
  );
}
// #endregion

// #region example end-to-end (siwe)
/* eslint-disable no-console */
// #region end-user flow
const last4 = "1234";
const owner = mnemonicToAccount("test test test test test test test test test test test junk"); // placeholder
const factory = zeroAddress; // placeholder, will be user-provided
const message = createSiweMessage({
  statement: `I authorize account ${deriveAddress(factory, {
    x: padHex(owner.address, { size: 32, dir: "left" }),
    y: zeroHash,
  })} to be associated with the card ending in ${last4}.`,
  resources: ["https://exactly.github.io/exa"],
  nonce: generateSiweNonce(),
  uri: `https://${domain}`,
  address: owner.address,
  chainId: chain.id,
  scheme: "https",
  version: "1",
  domain,
});
owner
  .signMessage({ message })
  // #endregion
  .then(async (signature) => {
    // #region account association
    const account = await getAccount(last4, { method: "siwe", factory, message, signature });
    console.log(`${account} associated with card ${last4}`);
    // #endregion

    // #region transaction signing example
    const amount = 420_000_000n; // 420 USDC (6 decimals)
    const timestamp = Math.floor(Date.now() / 1000); // in seconds
    const spend = await signIssuerOp({ account, amount, timestamp });
    const refund = await signIssuerOp({ account, amount: -amount, timestamp });
    // #endregion

    // #region informational only, reproducing the onchain check
    if (
      (await recoverTypedDataAddress({
        domain: { chainId: chain.id, name: "IssuerChecker", version: "1", verifyingContract },
        types: {
          Collection: [
            { name: "account", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "timestamp", type: "uint40" },
          ],
        },
        primaryType: "Collection",
        message: { account, amount, timestamp },
        signature: spend,
      })) !== issuer.address
    ) {
      throw new Error("bad signature");
    }
    if (
      (await recoverTypedDataAddress({
        domain: { chainId: chain.id, name: "IssuerChecker", version: "1", verifyingContract },
        types: {
          Refund: [
            { name: "account", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "timestamp", type: "uint40" },
          ],
        },
        primaryType: "Refund",
        message: { account, amount, timestamp },
        signature: refund,
      })) !== issuer.address
    ) {
      throw new Error("bad signature");
    }
    // #endregion
  })
  .catch(console.error);
/* eslint-enable no-console */
// #endregion
