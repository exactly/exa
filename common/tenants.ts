import { parse } from "valibot";

import { Address } from "./validation";

const tenants: Record<string, Address> = {
  "https://business.base-sepolia.exactly.app": parse(Address, "0xB527Bc180aC0c64602a79e62D0403660225b8198"),
  "https://business.exactly.app": parse(Address, "0x2dA79825d578F195aEDC5287642E16161b895Ced"), // TODO replace with the provisioned tenant
  "https://business.sandbox.exactly.app": parse(Address, "0xB527Bc180aC0c64602a79e62D0403660225b8198"),
};

export default tenants;
