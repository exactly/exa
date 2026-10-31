import { createRequire } from "node:module";
import process from "node:process";
import { rewriteTargetsAndProjects } from "nx/bin/init-local";
import {
  yargsAffectedCommand,
  yargsAffectedE2ECommand,
  yargsAffectedTestCommand,
} from "nx/src/command-line/affected/command-object";
import { parserConfiguration } from "nx/src/command-line/nx-commands";
import { yargsNxInfixCommand, yargsRunCommand } from "nx/src/command-line/run/command-object";
import { parseRunOneOptions } from "nx/src/command-line/run/run-one";
import { yargsRunManyCommand } from "nx/src/command-line/run-many/command-object";
import { readNxJson } from "nx/src/config/nx-json";
import { readCachedProjectGraph } from "nx/src/devkit-exports";
import { array, parse, string } from "valibot";

import type { commandsObject } from "nx/src/command-line/nx-commands";
import type { PreTasksExecutionContext } from "nx/src/project-graph/plugins";

export const name = "@exactly/common/nx";

export async function preTasksExecution(_: unknown, { argv, workspaceRoot }: PreTasksExecutionContext) {
  const targets: string[] = [];
  await (createRequire(import.meta.resolve("nx"))("yargs") as typeof commandsObject)(rewriteTargetsAndProjects(argv))
    .parserConfiguration(parserConfiguration)
    .command({ ...yargsRunCommand, handler: one })
    .command({ ...yargsRunManyCommand, handler: many })
    .command({ ...yargsAffectedCommand, handler: many })
    .command({ ...yargsAffectedTestCommand, handler: () => many({ targets: ["test"] }) })
    .command({ ...yargsAffectedE2ECommand, handler: () => many({ targets: ["e2e"] }) })
    .command({ ...yargsNxInfixCommand, handler: one })
    .fail(false)
    .parse();
  const tests = targets.filter((target) => /^(?:test|e2e)(?::|$)/.test(target)).length;
  if (tests && tests < targets.length) throw new Error(`mixed test and non-test targets: ${targets.join(", ")}`);
  if (tests) process.env.CHAIN_ID = await import("viem/chains").then(({ anvil }) => String(anvil.id));
  if (targets.some((target) => /^e2e(?::|$)/.test(target))) {
    process.env.APP_DOMAIN ??= "localhost";
    process.env.EXPO_PUBLIC_ENV ??= "e2e";
  }

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
