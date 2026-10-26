import { parse } from "valibot";

import chain from "./generated/chain";
import { Address } from "./validation";

export const business = parse(
  Address,
  chain.testnet ? "0xB527Bc180aC0c64602a79e62D0403660225b8198" : "0xAd59d015ed78a8e0fF7050647E293141b3304044",
);

const tenants: Record<string, Address> = {
  "https://business.localhost": business,
  "https://business.base-sepolia.exactly.app": business,
  "https://business.exactly.app": business,
  "https://business.sandbox.exactly.app": business,
};

export default tenants;

export const tenantScript = `if (${JSON.stringify(Object.keys(tenants))}.includes(location.origin)) document.documentElement.dataset.tenant = "";`;
