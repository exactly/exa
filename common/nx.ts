import { createRequire } from "node:module";
import process from "node:process";
import { yargsAffectedCommand } from "nx/src/command-line/affected/command-object";
import { parserConfiguration } from "nx/src/command-line/nx-commands";
import { yargsNxInfixCommand, yargsRunCommand } from "nx/src/command-line/run/command-object";
import { parseRunOneOptions } from "nx/src/command-line/run/run-one";
import { yargsRunManyCommand } from "nx/src/command-line/run-many/command-object";
import { readNxJson } from "nx/src/config/nx-json";
import { readCachedProjectGraph } from "nx/src/devkit-exports";
import { array, parse, string } from "valibot";
import { anvil } from "viem/chains";

import type { commandsObject } from "nx/src/command-line/nx-commands";
import type { PreTasksExecutionContext } from "nx/src/project-graph/plugins";

export const name = "@exactly/common/nx";

export async function preTasksExecution(_: unknown, { argv, workspaceRoot }: PreTasksExecutionContext) {
  const targets: string[] = [];
  await (createRequire(import.meta.resolve("nx"))("yargs") as typeof commandsObject)(argv.slice(2))
    .parserConfiguration(parserConfiguration)
    .command({ ...yargsRunCommand, handler: one })
    .command({ ...yargsRunManyCommand, handler: many })
    .command({ ...yargsAffectedCommand, handler: many })
    .command({ ...yargsNxInfixCommand, handler: one })
    .fail(false)
    .parse();
  if (targets.some((target) => /^(?:test|e2e)(?::|$)/.test(target))) process.env.CHAIN_ID = String(anvil.id);

  function one(args: Record<string, unknown>) {
    targets.push(
      parse(
        string(),
        parseRunOneOptions(workspaceRoot, args, readCachedProjectGraph(), readNxJson(workspaceRoot)).target,
      ),
    );
  }

  function many(args: Record<string, unknown>) {
    targets.push(...parse(array(string()), args.targets));
  }
}
