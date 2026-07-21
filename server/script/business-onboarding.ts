import { readFile } from "node:fs/promises";
import { object, optional, parse, string, unknown } from "valibot";
import { privateKeyToAccount } from "viem/accounts";

import deriveAddress from "@exactly/common/deriveAddress";
import { Credential, Hex } from "@exactly/common/validation";

const baseURL = process.env.EXA_URL ?? "https://sandbox.exactly.app";

async function main() {
  const clientFid = required("BUSINESS_CLIENT_FID");
  const account = privateKeyToAccount(parse(Hex, required("SIWE_PRIVATE_KEY")));
  const challenge = await request(`/api/auth/registration?credentialId=${encodeURIComponent(account.address)}`);
  const { message } = parse(object({ message: string() }), challenge.data);
  const registration = await request("/api/auth/registration", {
    method: "POST",
    headers: {
      "Client-Fid": clientFid,
      cookie: cookie(challenge.response, "session_id"),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      method: "siwe",
      id: account.address,
      signature: await account.signMessage({ message }),
    }),
  });
  const credential = parse(Credential, registration.data);
  const companyApplication = await request("/api/kyc/application?type=business", {
    method: "POST",
    headers: { cookie: cookie(registration.response, "credential_id"), "content-type": "application/json" },
    body: JSON.stringify(JSON.parse(await readFile(required("BUSINESS_APPLICATION_FILE"), "utf8"))),
  });
  const companyData = parse(
    object({
      id: string(),
      applicationStatus: optional(string()),
      applicationCompletionLink: optional(unknown()),
      applicationExternalVerificationLink: optional(unknown()),
    }),
    companyApplication.data,
  );

  process.stdout.write(
    JSON.stringify(
      {
        account: deriveAddress(credential.factory, {
          x: credential.x,
          y: credential.y,
          salt: credential.salt,
        }),
        salt: credential.salt,
        applicationId: companyData.id,
        applicationCompletionLink: companyData.applicationCompletionLink,
        applicationExternalVerificationLink: companyData.applicationExternalVerificationLink,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseURL}${path}`, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${body}`);
  return { response, data: parse(unknown(), JSON.parse(body)) };
}

function cookie(response: Response, name: string) {
  const value = response.headers
    .getSetCookie()
    .find((header) => header.startsWith(`${name}=`))
    ?.split(";")[0];
  if (!value) throw new Error("missing authentication cookie");
  return value;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
