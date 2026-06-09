import { Attribution } from "ox/erc8021";
import { base } from "viem/chains";

import chain from "./generated/chain";

export const builderCode = { [base.id]: "bc_nx166f0a" }[chain.id];
export const dataSuffix = builderCode ? Attribution.toDataSuffix({ codes: [builderCode] }) : undefined;
