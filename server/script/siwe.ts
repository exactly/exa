/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { createAuthClient } from "better-auth/client";
import { siweClient } from "better-auth/client/plugins";
import { mnemonicToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const authClient = createAuthClient({
  baseURL: "http://localhost:3000",
  plugins: [siweClient()],
});

const owner = mnemonicToAccount("test test test test test test test test test test test junk"); // placeholder

// eslint-disable-next-line @typescript-eslint/no-misused-promises
setTimeout(async () => {
  const { data, error } = await authClient.siwe.nonce({
    walletAddress: owner.address,
    chainId: 1, // optional, defaults to 1 (Ethereum mainnet)
  });

  if (data) {
    console.log("Nonce:", data.nonce);
  }

  const statement = `the statement`;
  const nonce = data?.nonce ?? "";
  console.log(statement);
  const message = createSiweMessage({
    statement,
    resources: ["https://exactly.github.io/exa"],
    nonce,
    uri: `https://localhost`,
    address: owner.address,
    chainId: 1,
    scheme: "https",
    version: "1",
    domain: "localhost",
  });
  const signature = await owner.signMessage({ message });
  console.log(signature);

  const siweVerifyResult = await authClient.siwe.verify({
    message,
    signature,
    walletAddress: owner.address,
    chainId: 1, // optional, defaults to 1
  });
  if (siweVerifyResult.data) {
    console.log("Authentication successful:", siweVerifyResult.data.user);
  } else {
    console.log("Authentication failed:", siweVerifyResult.error);
  }

}, 0);
