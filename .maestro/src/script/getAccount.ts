import type { Address } from "viem";

declare const output: { account?: Address; credential?: string };

const { ok, status, body } = http.get("http://localhost:3000/e2e/credential");
if (!ok) throw new Error(`${status} ${body}`);
const credential = JSON.parse(body) as { account: Address; id: string };
output.account = credential.account;
output.credential = credential.id;
