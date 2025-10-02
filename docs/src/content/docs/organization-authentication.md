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

Example code to authenticate using SIWE, it will create the user if doesn't exist with an auto generated email that will be needed
when an admin generates invites. It is possible also to change the auto generated email to a custom one using `authClient.changeEmail`

```typescript
import { createAuthClient } from "better-auth/client";
import { siweClient, organizationClient } from "better-auth/client/plugins";
import { privateKeyToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

const chainId = optimismSepolia.id;

const domain = "sandbox.exactly.app";

const authClient = createAuthClient({
  baseURL: `https://${domain}`,
  plugins: [siweClient(), organizationClient()],
});
const owner = privateKeyToAccount(process.env.INTEGRATOR_ADMIN_PRIVATE_KEY as `0x${string}`);

authClient.siwe
  .nonce({
    walletAddress: owner.address,
    chainId,
  })
  .then(async ({ data: nonceResult }) => {
    if (!nonceResult) throw new Error("No nonce");
    //can be any statement
    const statement = "i accept exa terms and conditions";
    const message = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce: nonceResult.nonce,
      uri: `https://${domain}`,
      address: owner.address,
      chainId,
      scheme: "https",
      version: "1",
      domain,
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
          console.log("j", JSON.stringify(context.data, null, 2));
          const headers = new Headers();
          const cookie = context.response.headers.get("set-cookie");
          if (!cookie) throw new Error("No cookie");
          headers.set("cookie", cookie);
          console.log("default email for invites", `${owner.address.toLowerCase()}@https://${domain}`);
          console.log("auth cookie", cookie);
          const changeEmail = false;
          if (changeEmail) {
            const { data: changeEmailResult, error: changeEmailError } = await authClient.changeEmail({
              fetchOptions: {
                headers,
              },
              newEmail: "foo@example.com",
            });
            if (changeEmailResult?.status) {
              console.log("new email for invites: foo@example.com", changeEmailResult);
            } else {
              console.error("error changing email", changeEmailError);
            }
          }
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

*Output changeEmail=false:*
<!-- cspell:ignore FIMNWRCs -->
```log
default email for invites 0xd2e4862f5b12888750c3de8bd355a8bea72563db@https://sandbox.exactly.app
auth cookie __Secure-better-auth.session_token=************************.hdFMxm%2B3lfFT1r0PzlAJV1rBu1158FIMNWRCsPyKc20%3D; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax, __cf_bm=xnlWakZTNl.7UbT9hFNiwBoVaynqh_JAAIdKpKD0VxM-1759413526-1.0.1.1-cFxObTiGDHlFoAfPHuU0ha4W_ha9_zwmFWTKcrTC0Zr6MCmtUVGpMLMxH5GX2HiekLpnXFNMJ415sVPuJRO8H2EfywCSEqbulhMxzbYMezw; path=/; expires=Thu, 02-Oct-25 14:28:46 GMT; domain=.sandbox.exactly.app; HttpOnly; Secure; SameSite=None
```

*Output changeEmail=true:*
<!-- cspell:ignore Hecj Njsn Jgpe SWVD Olyc -->
```log
default email for invites 0xd2e4862f5b12888750c3de8bd355a8bea72563db@https://sandbox.exactly.app
auth cookie __Secure-better-auth.session_token=******************.dHecjPNjsnJ5CyRtsZ%2FovQbtMsDJgpeSWVD2OlycBW4%3D; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax, __cf_bm=dplXTM4T0iJfoIzqnFGZagTOYedVS6a9tIZGoZeomYU-1759413785-1.0.1.1-0fZC9AG_Y9FDvGSmOJKq5r81Vrvw8c_GwHf6Afh_gNMibNFWLbeX6_YFv2F7VDj9FiuavPdCL.yS7h0MSF92asErgnhDUZu4262YzTacY3s; path=/; expires=Thu, 02-Oct-25 14:33:05 GMT; domain=.sandbox.exactly.app; HttpOnly; Secure; SameSite=None
new email for invites: foo@example.com { status: true }
```

## Creating an organization

owner account will be the owner of the created organization

```typescript
import { createAuthClient } from "better-auth/client";
import { siweClient, organizationClient } from "better-auth/client/plugins";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

const chainId = baseSepolia.id;
const API_BASE_URL = process.env.API_BASE_URL;
if (!API_BASE_URL) throw new Error("API_BASE_URL environment variable is required");

const authClient = createAuthClient({
  baseURL: process.env.API_BASE_URL,
  plugins: [siweClient(), organizationClient()],
});

const owner = privateKeyToAccount(process.env.INTEGRATOR_ADMIN_PRIVATE_KEY as Hex);

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
      uri: API_BASE_URL,
      address: owner.address,
      chainId,
      scheme: "https",
      version: "1",
      domain: new URL(API_BASE_URL).hostname,
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
import crypto from "node:crypto";
import { getAddress, sha256 } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";

const chainId = optimismSepolia.id;

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
  nonce: generateSiweNonce(),
  uri: `https://sandbox.exactly.app`,
  address: owner.address,
  chainId,
  scheme: "https",
  version: "1",
  domain: "sandbox.exactly.app",
});
owner.signMessage({ message })
  .then((signature) => {
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
    console.error("error", error);
  });
  ```

## How to send an Invite to the Integrator organization

The integrator address needs to have owner or admin roles.

```typescript
import { createAuthClient } from "better-auth/client";
import { siweClient, organizationClient } from "better-auth/client/plugins";
import { privateKeyToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

const chainId = optimismSepolia.id;

const domain = "sandbox.exactly.app";

const authClient = createAuthClient({
  baseURL: `https://${domain}`,
  plugins: [siweClient(), organizationClient()],
});

// send invite

const owner = privateKeyToAccount(process.env.INTEGRATOR_ADMIN_PRIVATE_KEY as `0x${string}`);

authClient.siwe
  .nonce({
    walletAddress: owner.address,
    chainId,
  })
  .then(async ({ data: nonceResult }) => {
    if (!nonceResult) throw new Error("No nonce");
    const statement = `i accept exa terms and conditions`;
    const message = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce: nonceResult.nonce,
      uri: `https://${domain}`,
      address: owner.address,
      chainId,
      scheme: "https",
      version: "1",
      domain,
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
          const { data, error } = await authClient.organization.inviteMember({
            email: "bob@integrator.com",
            role: "admin",
            organizationId: "<organization-id>",
            fetchOptions: { headers },
          });
          if (!data) {
            console.error(error);
            return;
          }
          console.log(`invite id ${data.id}, email ${data.email}. Expires at ${data.expiresAt.toISOString()}`);
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

## How to accept an invite from the integrator organization

Use the invite id generated by the owner or the admin role of the organization and your private key.

```typescript
import { createAuthClient } from "better-auth/client";
import { siweClient, organizationClient } from "better-auth/client/plugins";
import { privateKeyToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

const chainId = optimismSepolia.id;

const domain = "sandbox.exactly.app";

const authClient = createAuthClient({
  baseURL: `https://${domain}`,
  plugins: [siweClient(), organizationClient()],
});

const owner = privateKeyToAccount(process.env.INTEGRATOR_ADMIN_PRIVATE_KEY as `0x${string}`);

authClient.siwe
  .nonce({
    walletAddress: owner.address,
    chainId,
  })
  .then(async ({ data: nonceResult }) => {
    if (!nonceResult) throw new Error("No nonce");
    const statement = `i accept exa terms and conditions`;
    const message = createSiweMessage({
      statement,
      resources: ["https://exactly.github.io/exa"],
      nonce: nonceResult.nonce,
      uri: `https://${domain}`,
      address: owner.address,
      chainId,
      scheme: "https",
      version: "1",
      domain,
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
          const { data, error } = await authClient.organization.acceptInvitation({
            fetchOptions: {
              headers,
            },
            invitationId: "<invitation-id>",
          });
          if (!data) {
            console.error(error);
            return;
          }
          console.log(data);
        },
        onError: (context) => {
          console.log("authorization error", context);
        },
      },
    );
  })
  .catch((error: unknown) => {
    console.error("error", error);
  });
  ```
