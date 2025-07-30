/* eslint-disable @eslint-community/eslint-comments/disable-enable-pair */
/* eslint-disable no-console */
import pem from "@exactly/common/pandaCertificate";
import crypto from "node:crypto";
import { pipe, string, check, transform, brand, literal, object, parse } from "valibot";
import { checksumAddress, createWalletClient, http, type Address as ViemAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";

const API_BASE_URL = process.env.API_BASE_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY_WALLET;

if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY environment variable is required");
if (!API_BASE_URL) throw new Error("API_BASE_URL environment variable is required");

const Address = pipe(
  string("bad address"),
  check((input) => isAddress(input, { strict: false }), "bad address"),
  transform((input) => checksumAddress(input as ViemAddress)),
  brand("Address"),
);

const AuthenticationOptions = object({
  method: literal("siwe"),
  address: Address,
  message: string(),
});

const KYCStatus = object({
  code: string(),
  legacy: string(),
  status: string(),
  reason: string(),
});

const BadRequest = object({
  code: string(),
  legacy: string(),
});

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({
  account,
  chain: optimismSepolia,
  transport: http(),
});

console.log(`🔑 Using wallet address: ${account.address}`);

const AUTH_HEADERS = {
  Cookie: "",
  sessionid: "",
};

async function getAuthOptions(address: string) {
  console.log("Getting SIWE authentication options...");

  const response = await fetch(`${API_BASE_URL}/api/auth/authentication?credentialId=${address}`);

  if (!response.ok) {
    throw new Error(`Failed to get auth options: ${response.status} ${response.statusText}`);
  }

  const setCookieHeader = response.headers.get("set-cookie");
  const sessionCookie = setCookieHeader?.match(/session_id=([^;]+)/)?.[1];

  if (!sessionCookie) {
    throw new Error("No session cookie received");
  }

  const data = await response.json();
  const authOptions = parse(AuthenticationOptions, data);
  console.log("Received SIWE message to sign");
  AUTH_HEADERS.Cookie = setCookieHeader;
  AUTH_HEADERS.sessionid = sessionCookie;
  return {
    authOptions,
  };
}

async function signSiwe(message: string) {
  console.log("✍️  Signing SIWE message...");

  const signature = await wallet.signMessage({
    message,
    account,
  });

  console.log("✅ Message signed successfully");
  return signature;
}

async function authenticate(address: string, signature: string) {
  console.log("Authenticating with signed message...");

  const response = await fetch(`${API_BASE_URL}/api/auth/authentication`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
    },
    credentials: "include",
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
  if (!setCookieHeader) {
    throw new Error("No set-cookie header received");
  }
  AUTH_HEADERS.Cookie = setCookieHeader;

  console.log("✅ Authentication successful!");
}

async function getKyc() {
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
    return parse(BadRequest, data);
  }

  const data = await response.json();
  return parse(KYCStatus, data);
}

async function submitKyc() {
  console.log("Submitting KYC application...");

  try {
    const response = await fetch(`${API_BASE_URL}/api/kyc/application`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...AUTH_HEADERS,
      },
      body: JSON.stringify(kycPayload),
    });

    if (!response.ok) {
      console.log(`KYC application submission failed: ${response.status} ${response.statusText}`);
      console.log("Error Response:", await response.text());
    }
  } catch (error) {
    console.log("KYC application submission failed:", error);
  }
}

async function getCard() {
  console.log("Getting card...");
  const secret = crypto.randomUUID().replaceAll("-", "");
  const secretKeyBase64 = Buffer.from(secret, "hex").toString("base64");
  const secretKeyBase64Buffer = Buffer.from(secretKeyBase64, "utf8");
  const secretKeyBase64BufferEncrypted = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    secretKeyBase64Buffer,
  );

  const response = await fetch(`${API_BASE_URL}/api/card`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
      sessionid: secretKeyBase64BufferEncrypted.toString("base64"),
    },
  });

  if (!response.ok) {
    const data = await response.json();
    return parse(BadRequest, data);
  }

  // TODO decrypt the card details
  const data = await response.json();
  console.log("Card", data);
  return true;
}

async function createCard() {
  console.log("Creating card...");

  const response = await fetch(`${API_BASE_URL}/api/card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...AUTH_HEADERS,
    },
  });

  if (!response.ok) {
    const data = await response.json();
    return parse(BadRequest, data);
  }
  return true;
}

async function example() {
  try {
    console.log("🚀 Starting SIWE authentication flow...\n");

    const { authOptions } = await getAuthOptions(account.address);
    const signature = await signSiwe(authOptions.message);
    await authenticate(account.address, signature);

    console.log("\n🎉 Authentication flow completed successfully!");

    const kyc = await getKyc();
    if (kyc.code === "not started") {
      console.log("KYC application not started, submitting...");
      await submitKyc();
      console.log("✅ KYC application submitted successfully");
    } else {
      console.log("KYC application already submitted");
    }

    const card = await getCard();
    if (card === true) {
      console.log("✅ Card already exists");
    } else {
      await createCard();
      console.log("✅ Card created successfully");
    }
  } catch (error) {
    console.error("❌ Failed to complete SIWE flow:", error);
    // eslint-disable-next-line unicorn/no-process-exit, n/no-process-exit
    process.exit(1);
  }
}

example().catch(console.error);

// TODO encrypt
const kycPayload = {
  firstName: "John",
  lastName: "TestApproved",
  birthDate: "1990-01-15",
  nationalId: "123456789",
  countryOfIssue: "US",
  email: "john.doe@example.com",
  phoneCountryCode: "1",
  phoneNumber: "5551234567",
  ipAddress: "192.168.1.1",
  occupation: "software engineer",
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
