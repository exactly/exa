import { env } from "node:process";
if (!env.AUTH_SECRET) throw new Error("missing auth secret");

export default env.AUTH_SECRET as string; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
