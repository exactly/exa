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
          // authentication successful, session cookie is now set
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

Owner account will be the owner of the created organization.

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

## Creating a webhook with the authenticated header

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
          // returns 201 with the created webhook (including its secret) on success,
          // or 409 { code: "name conflict" } if a webhook with this name already exists
          const newWebhook = await authClient.$fetch(`${baseURL}/api/webhook`, {
            headers,
            method: "POST",
            body: {
              name: "foobar",
              url: "https://test.com",
            },
          });
          console.log("new webhook", newWebhook);

          // fetch a single webhook by name
          const oneWebhook = await authClient.$fetch(`${baseURL}/api/webhook/foobar`, { headers });
          console.log("one webhook", oneWebhook);

          // update an existing webhook (returns 404 if it does not exist; the signing secret is preserved and not returned)
          const updated = await authClient.$fetch(`${baseURL}/api/webhook/foobar`, {
            headers,
            method: "PATCH",
            body: { url: "https://updated.test.com" },
          });
          console.log("updated webhook", updated);

          // delete a webhook (returns 404 if it does not exist)
          const deleted = await authClient.$fetch(`${baseURL}/api/webhook/foobar`, {
            headers,
            method: "DELETE",
          });
          console.log("deleted webhook", deleted);
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
