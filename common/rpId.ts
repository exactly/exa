import chain from "./generated/chain";

export default `${chain.testnet ? "sandbox" : "web"}.exactly.app`;
