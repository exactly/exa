import { createRequire } from "node:module";
import process from "node:process";
import { array, parse, string } from "valibot";

import type { commandsObject } from "nx/src/command-line/nx-commands";
import type { PreTasksExecutionContext } from "nx/src/project-graph/plugins";

export const name = "@exactly/common/nx";

export async function preTasksExecution(
  _: unknown,
  { argv, workspaceRoot, nxJsonConfiguration }: PreTasksExecutionContext,
) {
  const [
    { rewriteTargetsAndProjects },
    { yargsAffectedCommand, yargsAffectedE2ECommand, yargsAffectedTestCommand },
    { parserConfiguration },
    { yargsNxInfixCommand, yargsRunCommand },
    { parseRunOneOptions },
    { yargsRunManyCommand },
    { readCachedProjectGraph },
  ] = await Promise.all([
    import("nx/bin/init-local"),
    import("nx/src/command-line/affected/command-object"),
    import("nx/src/command-line/nx-commands"),
    import("nx/src/command-line/run/command-object"),
    import("nx/src/command-line/run/run-one"),
    import("nx/src/command-line/run-many/command-object"),
    import("nx/src/devkit-exports"),
  ]);
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
  if (tests) process.env.CHAIN_ID = "31337";
  if (targets.some((target) => /^e2e(?::|$)/.test(target))) {
    const web = targets.some((target) => /^e2e:web(?::|$)/.test(target));
    process.env.APP_DOMAIN ??= web ? "exa.localhost" : "localhost";
    if (web && process.env.APP_DOMAIN !== "exa.localhost") {
      throw new Error(`web e2e serves exa.localhost, not ${process.env.APP_DOMAIN}`);
    }
    if (targets.includes("e2e:web")) process.env.EXPO_PACKAGER_PROXY_URL ??= "https://exa.localhost";
    process.env.EXPO_PUBLIC_ENV ??= "e2e";
  }

  function one(args: Record<string, unknown>) {
    targets.push(
      parse(string(), parseRunOneOptions(workspaceRoot, args, readCachedProjectGraph(), nxJsonConfiguration).target),
    );
  }

  function many(args: Record<string, unknown>) {
    targets.push(...parse(array(string()), args.targets));
  }
}
