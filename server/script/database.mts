import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { writeFile } from "node:fs/promises";

import * as schema from "../database/schema";

await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema)).then((statements) =>
  writeFile("generated/schema.sql", statements.join("\n")),
);
