import type { LocalWorkspace } from "@pulumi/pulumi/automation";

export default async function rejectSecrets(name: string, workspace: LocalWorkspace) {
  const settings = await workspace.stackSettings(name);
  visit(settings.config);

  function visit(value: unknown): void {
    if (typeof value !== "object" || value === null) return;
    if (Object.hasOwn(value, "secure")) throw new Error(`pulumi secrets are not allowed in ${name}`);
    for (const item of Object.values(value)) visit(item);
  }

  return settings;
}
