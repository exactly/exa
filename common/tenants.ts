import { parse } from "valibot";

import { Address } from "./validation";

export default new Map<string, "" | Address>([
  ["http://localhost:8081", ""],
  ["https://base-sepolia.exactly.app", ""],
  ["https://base.exactly.app", ""],
  ["https://business.exactly.app", parse(Address, "0x2dA79825d578F195aEDC5287642E16161b895Ced")], // TODO replace with the provisioned tenant
  ["https://business.sandbox.exactly.app", parse(Address, "0x2dA79825d578F195aEDC5287642E16161b895Ced")],
  ["https://sandbox.exactly.app", ""],
  ["https://web.exactly.app", ""],
]);
