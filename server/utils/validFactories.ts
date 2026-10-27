import { exaAccountFactoryAddress, factories } from "@exactly/common/generated/chain";

import type { Address } from "viem";

const validFactories = new Set<Address>(factories.versions);

if (!validFactories.has(exaAccountFactoryAddress)) throw new Error("missing latest factory");

export default validFactories;
