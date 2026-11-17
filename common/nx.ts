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
    const https = targets.some((target) => /^e2e:(?:ios|web)(?::|$)/.test(target));
    process.env.APP_DOMAIN ??= https ? "exa.localhost" : "localhost";
    const domain = process.env.APP_DOMAIN;
    if (https && domain !== "exa.localhost") throw new Error(`ios and web e2e serve exa.localhost, not ${domain}`);
    if (targets.some((target) => /^e2e:ios(?::|$)/.test(target))) {
      process.env.APPLE_TEAM_ID ??= "665NDX7LBZ";
      process.env.HTTPS_PORT ??= "443";
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
