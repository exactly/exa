import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import pem from "@exactly/common/pandaCertificate";
import crypto from "node:crypto";
import * as v from "valibot";
import {
  type Address as ViemAddress,
  type Hash as ViemHash,
  createPublicClient,
  createWalletClient,
  checksumAddress,
  isAddress,
  isHash,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";

/* eslint-disable no-console */

const API_BASE_URL = process.env.API_BASE_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY_WALLET;
const FIRST_NAME_ID =
  process.env.FIRST_NAME_ID ?? Array.from({ length: 8 }, () => Math.random().toString(36).charAt(2)).join("");

if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY environment variable is required");
if (!API_BASE_URL) throw new Error("API_BASE_URL environment variable is required");

// #region schemas
const BadRequest = v.object({ code: v.string(), legacy: v.string() });
const Hash = v.custom<ViemHash>(isHash as (hash: unknown) => hash is ViemHash, "bad hash");
const Base64URL = v.pipe(v.string("bad base64url"), v.regex(/^[\w-]+$/, "bad base64url"));

const Address = v.pipe(
  v.string("bad address"),
  v.check((input) => isAddress(input, { strict: false }), "bad address"),
  v.transform((input) => checksumAddress(input as ViemAddress)),
  v.brand("Address"),
);

const AuthenticationOptions = v.object({
  method: v.literal("siwe"),
  address: Address,
  message: v.string(),
});

const AuthenticationResponse = v.object({
  credentialId: Base64URL,
  factory: Address,
  x: Hash,
  y: Hash,
});

const KYCStatus = v.object({
  code: v.string(),
  legacy: v.string(),
  status: v.string(),
  reason: v.string(),
});

const CardResponse = v.object({
  displayName: v.string(),
  encryptedPan: v.object({
    data: v.string(),
    iv: v.string(),
  }),
  encryptedCvc: v.object({
    data: v.string(),
    iv: v.string(),
  }),
  expirationMonth: v.string(),
  expirationYear: v.string(),
  lastFour: v.string(),
  mode: v.number(),
  pin: v.nullable(
    v.object({
      data: v.string(),
      iv: v.string(),
    }),
  ),
  provider: v.literal("panda"),
  status: v.picklist(["ACTIVE", "FROZEN"]),
});

const CardStatus = v.picklist(["active", "canceled", "locked", "notActivated"]);
const CreatedCardResponse = v.object({
  lastFour: v.string(),
  status: CardStatus,
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const UpdateCard = v.union([
  v.strictObject({ mode: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_INSTALLMENTS)) }),
  v.strictObject({ status: v.picklist(["ACTIVE", "FROZEN"]) }),
  v.strictObject({ data: v.string(), iv: v.string(), sessionId: v.string() }),
]);

const UpdatedCardResponse = v.union([
  v.object({
    data: v.string(),
    iv: v.string(),
  }),
  v.object({
    mode: v.number(),
  }),
  v.object({
    status: v.picklist(["ACTIVE", "FROZEN", "DELETED"]),
  }),
]);

// #endregion schemas

// #region utilities
function session(): { id: string; secret: string } {
  const secret = crypto.randomUUID().replaceAll("-", "");
  const secretKeyBase64 = Buffer.from(secret, "hex").toString("base64");
  const secretKeyBase64Buffer = Buffer.from(secretKeyBase64, "utf8");
  const secretKeyBase64BufferEncrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    secretKeyBase64Buffer,
  );
  return {
    id: secretKeyBase64BufferEncrypted.toString("base64"),
    secret,
  };
}

async function encrypt(data: string): Promise<{ data: string; iv: string; sessionId: string }> {
  const { id: sessionId, secret } = session();
  const keyBytes = new Uint8Array(Buffer.from(secret, "hex"));
  const iv = crypto.randomBytes(16);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const encryptedData = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(data));
  return {
    sessionId,
    iv: Buffer.from(iv).toString("base64"),
    data: Buffer.from(encryptedData).toString("base64"),
  };
}

function decrypt(base64Secret: string, base64Iv: string, secretKey: string): string {
  const secret = Buffer.from(base64Secret, "base64");
  const iv = Buffer.from(base64Iv, "base64");
  const decipher = crypto.createDecipheriv("aes-128-gcm", Buffer.from(secretKey, "hex"), iv);
  decipher.setAutoPadding(false);
  decipher.setAuthTag(secret.subarray(-16));
  return Buffer.concat([decipher.update(secret.subarray(0, -16)), decipher.final()]).toString("utf8");
}

async function encryptPIN(pin: string) {
  if (pin.length !== 4) throw new Error(`pin must be 4 digits`);
  const data = `2${pin.length.toString(16)}${pin}${"F".repeat(14 - pin.length)}`;
  return await encrypt(data);
}

function decryptPIN(base64Secret: string, base64Iv: string, secretKey: string) {
  const data = decrypt(base64Secret, base64Iv, secretKey);
  const length = data.slice(1, 2);
  return data.slice(2, 2 + Number.parseInt(length, 10));
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({
  account,
  chain: optimismSepolia,
  transport: http(),
});

const client = createPublicClient({
  chain: optimismSepolia,
  transport: http(),
});

console.log(`🔑 Using wallet address: ${account.address}`);

const AUTH_HEADERS = {
  Cookie: "",
};
// #endregion utilities

// #region actions
async function getAuthOptions(address: string): Promise<v.InferOutput<typeof AuthenticationOptions>> {
  const response = await fetch(`${API_BASE_URL}/api/auth/authentication?credentialId=${address}`);
  if (!response.ok) {
    throw new Error(`Failed to get auth options: ${response.status} ${response.statusText}`);
  }
  const setCookieHeader = response.headers.get("set-cookie");
  const sessionCookie = setCookieHeader?.match(/session_id=([^;]+)/)?.[1];
  if (!sessionCookie) throw new Error("No session cookie received");

  const data = await response.json();
  const authOptions = v.parse(AuthenticationOptions, data);
  AUTH_HEADERS.Cookie = setCookieHeader;
  return authOptions;
}

async function signSiwe(message: string): Promise<`0x${string}`> {
  console.log("✍️  Signing SIWE message...");
  const signature = await wallet.signMessage({
    message,
    account,
  });
  return signature;
}

async function authenticate(address: string, signature: string): Promise<ViemAddress> {
  const response = await fetch(`${API_BASE_URL}/api/auth/authentication`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
    },
    body: JSON.stringify({
      method: "siwe",
      id: address,
      signature,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Authentication failed: ${response.status} ${response.statusText} - ${error}`);
  }
  const setCookieHeader = response.headers.get("set-cookie");
  if (!setCookieHeader) throw new Error("No set-cookie header received");
  AUTH_HEADERS.Cookie = setCookieHeader;

  const data = await response.json();
  const authResponse = v.parse(AuthenticationResponse, data);

  const accountAddress = await client.readContract({
    address: authResponse.factory,
    abi: exaAccountFactoryAbi,
    functionName: "getAddress",
    args: [
      0n,
      [
        {
          x: BigInt(authResponse.x),
          y: BigInt(authResponse.y),
        },
      ],
    ],
  });
  return accountAddress;
}

async function getKyc(): Promise<v.InferOutput<typeof KYCStatus> | v.InferOutput<typeof BadRequest>> {
  console.log("Getting KYC application...");

  const response = await fetch(`${API_BASE_URL}/api/kyc/application`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
    },
  });

  if (!response.ok) {
    const data = await response.json();
    return v.parse(BadRequest, data);
  }

  const data = await response.json();
  return v.parse(KYCStatus, data);
}

async function submitKyc() {
  console.log("Submitting KYC application...");

  const response = await fetch(`${API_BASE_URL}/api/kyc/application`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
    },
    body: JSON.stringify(kycPayload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`KYC application submission failed: ${response.status} ${response.statusText} - ${error}`);
  }
}

async function getCard(): Promise<
  | {
      details: v.InferOutput<typeof CardResponse>;
      pan: string;
      cvc: string;
      pin: string | null;
    }
  | undefined
> {
  const { id, secret } = session();
  const response = await fetch(`${API_BASE_URL}/api/card`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
      sessionid: id,
    },
  });

  if (!response.ok) {
    if (response.status === 404) return;
    const error = await response.text();
    throw new Error(`Failed to get card: ${response.status} ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  const details = v.parse(CardResponse, data);

  const pan = decrypt(details.encryptedPan.data, details.encryptedPan.iv, secret);
  const cvc = decrypt(details.encryptedCvc.data, details.encryptedCvc.iv, secret);
  const pin = details.pin ? decryptPIN(details.pin.data, details.pin.iv, secret) : null;
  return { details, pan, cvc, pin };
}

async function createCard(): Promise<v.InferOutput<typeof CreatedCardResponse>> {
  console.log("Creating card...");
  const response = await fetch(`${API_BASE_URL}/api/card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create card: ${response.status} ${response.statusText} - ${error}`);
  }

  const data = await response.json();
  return v.parse(CreatedCardResponse, data);
}

async function updateCard(
  payload: v.InferOutput<typeof UpdateCard>,
): Promise<v.InferOutput<typeof UpdatedCardResponse>> {
  const response = await fetch(`${API_BASE_URL}/api/card`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update card: ${response.status} ${response.statusText} - ${error}`);
  }
  const data = await response.json();
  return v.parse(UpdatedCardResponse, data);
}
// #endregion actions

// #region flows
async function onboarding() {
  console.log("🚀 Starting onboarding flow...\n");
  const authOptions = await getAuthOptions(account.address);
  const signature = await signSiwe(authOptions.message);
  const accountAddress = await authenticate(account.address, signature);
  console.log(
    `\n⚠️ Ensure that USDC faucet funds are sent to the Exa account ${accountAddress} in order to start using the card.\n`,
  );

  const kyc = await getKyc();
  if (kyc.code === "not started") {
    console.log("KYC application not started, submitting...");
    await submitKyc();
    console.log("✅ KYC application submitted successfully");
  } else {
    console.log("KYC application already submitted");
  }

  const card = await getCard();
  if (!card) {
    const newCard = await createCard();
    console.log("✅ Card created successfully:", newCard.lastFour);
  } else if (card.details.status === "ACTIVE") {
    console.log("✅ Card already exists:", {
      lastFour: card.details.lastFour,
      status: card.details.status,
      cvc: card.cvc,
      pan: card.pan,
      pin: card.pin,
    });
  } else {
    console.log("❌ Card is not active:", card.details.status);
  }
  console.log("🎉 Onboarding flow completed successfully!\n");
}

async function cardUpdates() {
  const newPin = Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, "0");
  const mode = Math.floor(Math.random() * MAX_INSTALLMENTS);
  console.log(`Updating: PIN: ${newPin}, Mode: ${mode}, Status: FROZEN/ACTIVE`);

  const authOptions = await getAuthOptions(account.address);
  const signature = await signSiwe(authOptions.message);
  await authenticate(account.address, signature);

  const card = await getCard();
  if (!card) throw new Error("No card found");
  const { pin } = card;
  console.log("Current PIN:", pin);

  console.log("\nUpdates:");
  const { data, iv, sessionId } = await encryptPIN(newPin);

  console.log(" - Freezing card");
  await updateCard({ status: "FROZEN" });

  console.log(" - Updating PIN");
  await updateCard({ iv, data, sessionId });

  console.log(" - Unfreezing card");
  await updateCard({ status: "ACTIVE" });

  console.log(` - Updating Mode to ${mode}`);
  await updateCard({ mode });

  console.log("\nGetting updated card...");
  const updatedCard = await getCard();
  if (!updatedCard) throw new Error("No card found");
  console.log("✅ Card updated successfully:", {
    lastFour: updatedCard.details.lastFour,
    status: updatedCard.details.status,
    mode: updatedCard.details.mode,
    pin: updatedCard.pin,
  });
}
// #endregion flows

const flow = process.argv[2] ?? "onboarding";
switch (flow) {
  case "onboarding":
    onboarding().catch(console.error);
    break;
  case "card-updates":
    cardUpdates().catch(console.error);
    break;
  default:
    console.error("❌ Invalid flow:", flow);
    process.exit(1); // eslint-disable-line unicorn/no-process-exit, n/no-process-exit
}

// #region mock data
// TODO encrypt
const kycPayload = {
  firstName: FIRST_NAME_ID,
  lastName: "TestApproved",
  birthDate: "1990-01-15",
  nationalId: "123456789",
  countryOfIssue: "US",
  email: "john.doe@example.com",
  phoneCountryCode: "1",
  phoneNumber: "5551234567",
  ipAddress: "192.168.1.1",
  occupation: "Software Developers, Applications",
  annualSalary: "7000",
  accountPurpose: "personal use",
  expectedMonthlyVolume: "5000",
  isTermsOfServiceAccepted: true,
  address: {
    line1: "123 main street",
    line2: "apt 1",
    city: "new york",
    region: "ny",
    postalCode: "10001",
    countryCode: "US",
    country: "united states",
  },
};
// #endregion mock data

const exaAccountFactoryAbi = [
  {
    type: "function",
    inputs: [
      { name: "salt", internalType: "uint256", type: "uint256" },
      {
        name: "owners",
        internalType: "struct PublicKey[]",
        type: "tuple[]",
        components: [
          { name: "x", internalType: "uint256", type: "uint256" },
          { name: "y", internalType: "uint256", type: "uint256" },
        ],
      },
    ],
    name: "getAddress",
    outputs: [{ name: "", internalType: "address", type: "address" }],
    stateMutability: "view",
  },
] as const;

/* eslint-enable no-console */
