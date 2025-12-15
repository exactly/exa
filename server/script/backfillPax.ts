/* eslint-disable no-console -- cli script */
import { inArray, isNotNull } from "drizzle-orm";
import { padHex } from "viem";

import database, { cards, credentials } from "../database";
import deriveAssociateId from "../utils/deriveAssociateId";
import { addCapita } from "../utils/pax";
import { getInquiry, PANDA_TEMPLATE } from "../utils/persona";

// Set required environment variables for module imports
process.env.ALCHEMY_ACTIVITY_ID = process.env.ALCHEMY_ACTIVITY_ID ?? "activity";
process.env.ALCHEMY_WEBHOOKS_KEY = process.env.ALCHEMY_WEBHOOKS_KEY ?? "webhooks";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "auth";
process.env.PAX_ASSOCIATE_ID_SECRET = process.env.PAX_ASSOCIATE_ID_SECRET ?? "pax";
process.env.BRIDGE_API_KEY = process.env.BRIDGE_API_KEY ?? "bridge";
process.env.BRIDGE_API_URL = process.env.BRIDGE_API_URL ?? "https://bridge.test";
process.env.EXPO_PUBLIC_ALCHEMY_API_KEY = process.env.EXPO_PUBLIC_ALCHEMY_API_KEY ?? " ";
process.env.INTERCOM_IDENTITY_KEY = process.env.INTERCOM_IDENTITY_KEY ?? "intercom";
process.env.ISSUER_PRIVATE_KEY = process.env.ISSUER_PRIVATE_KEY ?? padHex("0x420");
process.env.KEEPER_PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY ?? padHex("0x420");
process.env.MANTECA_API_KEY = process.env.MANTECA_API_KEY ?? "manteca";
process.env.MANTECA_API_URL = process.env.MANTECA_API_URL ?? "https://manteca.test";
process.env.MANTECA_WEBHOOKS_KEY = process.env.MANTECA_WEBHOOKS_KEY ?? "manteca";
process.env.PANDA_API_KEY = process.env.PANDA_API_KEY ?? "panda";
process.env.PANDA_API_URL = process.env.PANDA_API_URL ?? "https://panda.test";
process.env.PERSONA_WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET ?? "persona";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis";
process.env.SEGMENT_WRITE_KEY = process.env.SEGMENT_WRITE_KEY ?? "segment";

// These MUST be set for the script to work
if (!process.env.POSTGRES_URL) throw new Error("missing POSTGRES_URL");
if (!process.env.PERSONA_API_KEY) throw new Error("missing PERSONA_API_KEY");
if (!process.env.PERSONA_URL) throw new Error("missing PERSONA_URL");
if (!process.env.PAX_API_URL) throw new Error("missing PAX_API_URL");
if (!process.env.PAX_API_KEY) throw new Error("missing PAX_API_KEY");

interface BackfillResult {
  account: string;
  credentialId: string;
  status: "success" | "skipped" | "error";
  reason?: string;
}

async function backfillPax(dryRun: boolean): Promise<BackfillResult[]> {
  const results: BackfillResult[] = [];

  // Find all credentials that have at least one active or frozen card
  const credentialsWithCards = await database.query.credentials.findMany({
    columns: { id: true, account: true },
    where: isNotNull(credentials.pandaId),
    with: {
      cards: {
        columns: { id: true },
        where: inArray(cards.status, ["ACTIVE", "FROZEN"]),
      },
    },
  });

  // Filter to only those with cards
  const usersWithCards = credentialsWithCards.filter((c) => c.cards.length > 0);

  console.log(`Found ${usersWithCards.length} users with active cards to backfill`);

  for (const credential of usersWithCards) {
    const { id: credentialId, account } = credential;

    try {
      // Fetch Persona inquiry for this user
      const inquiry = await getInquiry(credentialId, PANDA_TEMPLATE);

      if (!inquiry) {
        results.push({ account, credentialId, status: "skipped", reason: "No Persona inquiry found" });
        console.log(`[SKIP] ${account}: No Persona inquiry found`);
        continue;
      }

      if (inquiry.attributes.status !== "approved" && inquiry.attributes.status !== "completed") {
        results.push({
          account,
          credentialId,
          status: "skipped",
          reason: `Persona inquiry status: ${inquiry.attributes.status}`,
        });
        console.log(`[SKIP] ${account}: Persona inquiry not approved (status: ${inquiry.attributes.status})`);
        continue;
      }

      const { attributes } = inquiry;

      // Extract user data - these fields are guaranteed on approved/completed inquiries
      const capitaData = {
        firstName: attributes["name-first"],
        lastName: attributes["name-last"],
        birthdate: attributes.birthdate,
        document: attributes.fields["identification-number"]?.value ?? "",
        email: attributes["email-address"],
        phone: attributes["phone-number"],
        internalId: deriveAssociateId(account),
        product: "travel insurance",
      };

      if (dryRun) {
        console.log(`[DRY-RUN] Would add ${account} to Pax with data:`, capitaData);
        results.push({ account, credentialId, status: "success", reason: "Dry run - would add to Pax" });
      } else {
        await addCapita(capitaData);
        console.log(`[SUCCESS] Added ${account} to Pax`);
        results.push({ account, credentialId, status: "success" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[ERROR] ${account}: ${message}`);
      results.push({ account, credentialId, status: "error", reason: message });
    }
  }

  return results;
}

function printSummary(results: BackfillResult[]): void {
  const success = results.filter((r) => r.status === "success").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;

  console.log("\n--- Summary ---");
  console.log(`Total processed: ${results.length}`);
  console.log(`Success: ${success}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

  if (errors > 0) {
    console.log("\nErrors:");
    for (const result of results.filter((r) => r.status === "error")) {
      console.log(`  - ${result.account}: ${result.reason}`);
    }
  }
}

const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log("Running in DRY-RUN mode - no changes will be made\n");
}

backfillPax(dryRun)
  .then((results) => {
    printSummary(results);

    console.log("\nDone");
  })
  .catch((error: unknown) => {
    console.error("Fatal error:", error);

    throw error;
  });
/* eslint-enable no-console */
