import { parseArgs } from "node:util";

import { createSubtenant } from "../utils/panda";

process.stdout.write(
  `${JSON.stringify(await createSubtenant(parseArgs({ options: { name: { type: "string", short: "n" } } }).values.name), null, 2)}\n`,
);
