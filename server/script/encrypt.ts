import crypto from "node:crypto";

const PUBLIC_KEY_RSA = process.env.PUBLIC_KEY_RSA;
if (!PUBLIC_KEY_RSA) throw new Error("PUBLIC_KEY_RSA is not set");

const baseUrl = process.env.EXA_API_URL ?? "http://localhost:3000";

const payload = {
  firstName: "john",
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

const encrypt = (jsonPayload: string) => {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);

  const encryptedData = Buffer.concat([cipher.update(jsonPayload, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedKey = crypto.publicEncrypt(PUBLIC_KEY_RSA, aesKey);

  const encryptedPayload = {
    encryptedKey: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    data: encryptedData.toString("base64"),
    tag: authTag.toString("base64"),
  };
  return encryptedPayload;
};

console.log(encrypt(JSON.stringify(payload)));

fetch(`${baseUrl}/api/kyc/test-decrypt`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(encrypt(JSON.stringify(payload))),
})
  .then((response) =>
    response.json().then((data) => {
      console.log("Decrypted data:", data);
    }),
  )
  .catch((error: unknown) => {
    console.error(error);
  });
