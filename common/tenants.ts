import { parse } from "valibot";

import chain from "./generated/chain";
import { Address } from "./validation";

export const business = parse(
  Address,
  chain.testnet ? "0xB527Bc180aC0c64602a79e62D0403660225b8198" : "0x2dA79825d578F195aEDC5287642E16161b895Ced", // TODO replace with the provisioned tenant
);

const tenants: Record<string, Address> = {
  "https://business.localhost": business,
  "https://business.base-sepolia.exactly.app": business,
  "https://business.exactly.app": business,
  "https://business.sandbox.exactly.app": business,
};

export default tenants;
