import { anvil } from "viem/chains";

import alchemyAPIKeys from "./alchemyAPIKeys";
import chain from "./generated/chain";

const maybeKey =
  process.env.EXPO_PUBLIC_ALCHEMY_API_KEY || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  { ...alchemyAPIKeys, [anvil.id]: "" }[chain.id];
if (maybeKey === undefined) throw new Error("missing alchemy api key");
const alchemyAPIKey: string = maybeKey;

export default alchemyAPIKey;
