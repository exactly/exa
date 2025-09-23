---
title: Organizations, authentication and authorization
sidebar:
  label: Organizations and authentication
  order: 10
---

Creating organizations is permission-less. Any user can create an organization and will be the owner.
Then the owner can add members with admin role and those admins will be able to add more members with different roles.

Better auth client and viem are the recommended libraries to use for authentication and signing using SIWE.

## SIWE Authentication

Example code to authenticate using SIWE, it will create the user if doesn't exist.
Note: Check viem account to use a private key instead of a mnemonic.

```typescript
import { createAuthClient } from "better-auth/client";
import { siweClient, organizationClient } from "better-auth/client/plugins";
import { mnemonicToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

const chainId = optimismSepolia.id;

const authClient = createAuthClient({
  baseURL: "http://localhost:3000",
  plugins: [siweClient(), organizationClient()],
});

const owner = mnemonicToAccount("test test test test test test test test test test test test");

authClient.siwe
  .nonce({
    walletAddress: owner.address,
    chainId,
  })
  .then(async ({ data: nonceResult }) => {
    //can be any statement
    const statement = "i accept exa terms and conditions";
    const nonce = nonceResult?.nonce ?? "";
    const message = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce,
      uri: "https://localhost",
      address: owner.address,
      chainId,
      scheme: "https",
      version: "1",
      domain: "localhost",
    });
    const signature = await owner.signMessage({ message });

    await authClient.siwe.verify(
      {
        message,
        signature,
        walletAddress: owner.address,
        chainId,
      },
      {
        onSuccess: async (context) => {
          const headers = new Headers();
          headers.set("cookie", context.response.headers.get("set-cookie") ?? "");
        },
        onError: (context) => {
          console.log("authorization error", context);
        },
      },
    );
  }).catch((error: unknown) => {
    console.error("nonce error", error);
  });
```

## Creating an organization

owner account will be the owner of the created organization

```typescript
const chainId = optimismSepolia.id;

const authClient = createAuthClient({
  baseURL: "http://localhost:3000",
  plugins: [siweClient(), organizationClient()],
});

const owner = mnemonicToAccount("test test test test test test test test test test test siwe");

authClient.siwe
  .nonce({
    walletAddress: owner.address,
    chainId,
  })
  .then(async ({ data: nonceResult }) => {
    const statement = `i accept exa terms and conditions`;
    const nonce = nonceResult?.nonce ?? "";
    const message = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce,
      uri: `https://localhost`,
      address: owner.address,
      chainId,
      scheme: "https",
      version: "1",
      domain: "localhost",
    });
    const signature = await owner.signMessage({ message });

    await authClient.siwe.verify(
      {
        message,
        signature,
        walletAddress: owner.address,
        chainId,
      },
      {
        onSuccess: async (context) => {
          const headers = new Headers();
          headers.set("cookie", context.response.headers.get("set-cookie") ?? "");
          const createOrganizationResult = await authClient.organization.create({
            fetchOptions: { headers },
            name: "Uphold",
            slug: "uphold",
            keepCurrentActiveOrganization: false,
          });
          if (createOrganizationResult.data) {
            console.log(`organization created id: ${createOrganizationResult.data.id}`);
          } else {
            console.error("Failed to create organization error:", createOrganizationResult.error);
          }
        },
        onError: (context) => {
          console.log("authorization error", context);
        },
      },
    );
  }).catch((error: unknown) => {
    console.error("nonce error", error);
  });
  ```

## Using properly the header to create a webhook

  ```typescript
import { createAuthClient } from "better-auth/client";
import { siweClient, organizationClient } from "better-auth/client/plugins";
import { mnemonicToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

const chainId = optimismSepolia.id;
const baseURL = "http://localhost:3000";
const authClient = createAuthClient({
  baseURL,
  plugins: [siweClient(), organizationClient()],
});

const owner = mnemonicToAccount("test test test test test test test test test test test test");

authClient.siwe
  .nonce({
    walletAddress: owner.address,
    chainId,
  })
  .then(async ({ data: nonceResult }) => {
    const statement = `i accept exa terms and conditions`;
    const nonce = nonceResult?.nonce ?? "";
    const message = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce,
      uri: `https://localhost`,
      address: owner.address,
      chainId,
      scheme: "https",
      version: "1",
      domain: "localhost",
    });
    const signature = await owner.signMessage({ message });

    await authClient.siwe.verify(
      {
        message,
        signature,
        walletAddress: owner.address,
        chainId,
      },
      {
        onSuccess: async (context) => {
          const headers = new Headers();
          headers.set("cookie", context.response.headers.get("set-cookie") ?? "");
          const webhooks = await authClient.$fetch(`${baseURL}/api/webhook`, {
            headers,
          });
          console.log("webhooks", webhooks);

          // only if owner or admin roles for the organization
          const newWebhook = await authClient.$fetch(`${baseURL}/api/webhook`, {
            headers,
            method: "POST",
            body: {
              name: "foobar",
              url: "https://test.com",
            },
          });
          console.log("new webhook", newWebhook);
        },
        onError: (context) => {
          console.log("authorization error", context);
        },
      },
    );
  })
  .catch((error: unknown) => {
    console.error("nonce error", error);
  });

  ```

## How to create the encrypted KYC payload with SIWE statement

<!-- cspell:ignore oaep pkcs cipheriv -->
```typescript
import { createAuthClient } from "better-auth/client";
import { siweClient, organizationClient } from "better-auth/client/plugins";
import crypto from "node:crypto";
import { getAddress, sha256 } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

const chainId = optimismSepolia.id;

const authClient = createAuthClient({
  baseURL: "https://sandbox.exactly.app",
  plugins: [siweClient(), organizationClient()],
});

const owner = mnemonicToAccount("test test test test test test test test test test test siwe");

function encrypt(payload: string) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);

  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyZixoAuo015iMt+JND0y
usAvU2iJhtKRM+7uAxd8iXq7Z/3kXlGmoOJAiSNfpLnBAG0SCWslNCBzxf9+2p5t
HGbQUkZGkfrYvpAzmXKsoCrhWkk1HKk9f7hMHsyRlOmXbFmIgQHggEzEArjhkoXD
pl2iMP1ykCY0YAS+ni747DqcDOuFqLrNA138AxLNZdFsySHbxn8fzcfd3X0J/m/T
2dZuy6ChfDZhGZxSJMjJcintFyXKv7RkwrYdtXuqD3IQYakY3u6R1vfcKVZl0yGY
S2kN/NOykbyVL4lgtUzf0IfkwpCHWOrrpQA4yKk3kQRAenP7rOZThdiNNzz4U2BE
2wIDAQAB
-----END PUBLIC KEY-----`;

  const key = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey,
  );

  return {
    key: key.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
    hash: sha256(ciphertext),
  };
}

authClient.siwe
  .nonce({
    walletAddress: owner.address,
    chainId,
  })
  .then(async ({ data: nonceResult }) => {
    if (!nonceResult) throw new Error("No nonce");
    const data = {
      email: "john.doe@example.com",
      lastName: "Doe",
      firstName: "John",
      nationalId: "123456789",
      birthDate: "1990-05-15",
      countryOfIssue: "US",
      phoneCountryCode: "1",
      phoneNumber: "5551234567",
      address: {
        line1: "123 Main Street",
        line2: "Apt 4B",
        city: "New York",
        region: "NY",
        postalCode: "10001",
        countryCode: "US",
      },
      ipAddress: "192.168.1.100",
      occupation: "11-1011",
      annualSalary: "75000",
      accountPurpose: "Personal Banking",
      expectedMonthlyVolume: "5000",
      isTermsOfServiceAccepted: true,
    };
    const encryptedPayload = encrypt(JSON.stringify(data));
    const exaAccountUserAddress = "0xa7d5e73027844145A538F4bfD7b8d9b41d8B89d3";
    const statement = `I apply for KYC approval on behalf of address ${getAddress(exaAccountUserAddress)} with payload hash ${encryptedPayload.hash}`;
    const message = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce: nonceResult.nonce,
      uri: `https://sandbox.exactly.app`,
      address: owner.address,
      chainId,
      scheme: "https",
      version: "1",
      domain: "sandbox.exactly.app",
    });
    const signature = await owner.signMessage({ message });

    const verify = {
      message,
      signature,
      walletAddress: owner.address,
      chainId,
    };
    const { hash, ...payload } = encryptedPayload;
    console.log("application payload", { ...payload, verify });
  })
  .catch((error: unknown) => {
    console.error("nonce error", error);
  });
  ```
