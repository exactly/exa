import { eq } from "drizzle-orm";

import database, { credentials } from "../database";

export const DEFAULT_SOURCE = "EXA";

/**
 * Retrieves the source name for a credential.
 *
 * The source is determined by looking up the organization associated with the credential's source field.
 * If the credential has no source or the organization is not found, returns the default source "EXA".
 *
 * @param credentialId - The ID of the credential to look up
 * @returns The organization name or "EXA" if not found
 */
export default async function getSourceName(credentialId: string): Promise<string> {
  const creds = await database.query.credentials.findFirst({
    columns: { id: true, source: true },
    where: eq(credentials.id, credentialId),
    with: {
      organization: {
        columns: { name: true },
      },
    },
  });

  return creds?.organization?.name ?? DEFAULT_SOURCE;
}
