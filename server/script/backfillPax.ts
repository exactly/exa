import { inArray, isNotNull } from "drizzle-orm";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { padHex } from "viem";

import database, { cards, credentials } from "../database";
import deriveAssociateId from "../utils/deriveAssociateId";
import { addCapita } from "../utils/pax";
import { getAccount, getInquiry, PANDA_TEMPLATE } from "../utils/persona";

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

interface BackfillResult {
  account: string;
  credentialId: string;
  status: "success" | "skipped" | "error";
  reason?: string;
}

function maskPII(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 2) return value;
  return `${value[0]}***${value.at(-1)}`;
}

export default async function backfillPax(dryRun: boolean, delayMs = 250, skipCount = 0): Promise<BackfillResult[]> {
  // These MUST be set for the script to work
  if (!process.env.POSTGRES_URL) throw new Error("missing POSTGRES_URL");
  if (!process.env.PERSONA_API_KEY) throw new Error("missing PERSONA_API_KEY");
  if (!process.env.PERSONA_URL) throw new Error("missing PERSONA_URL");
  if (!process.env.PAX_API_URL) throw new Error("missing PAX_API_URL");
  if (!process.env.PAX_API_KEY) throw new Error("missing PAX_API_KEY");

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

  // Sort users deterministically by account (wallet address)
  const sortedUsers = usersWithCards.sort((a, b) => a.account.localeCompare(b.account));

  if (skipCount > 0) {
    // eslint-disable-next-line no-console -- cli script
    console.log(`Skipping first ${skipCount} users...`);
  }

  const usersToProcess = sortedUsers.slice(skipCount);

  for (const [index, credential] of usersToProcess.entries()) {
    const { id: credentialId, account } = credential;
    const globalIndex = skipCount + index + 1;
    const progress = `[${globalIndex}/${usersWithCards.length}]`;

    try {
      // Fetch Persona inquiry for this user
      const inquiry = await getInquiry(credentialId, PANDA_TEMPLATE);

      if (!inquiry) {
        results.push({ account, credentialId, status: "skipped", reason: "No Persona inquiry found" });
        // eslint-disable-next-line no-console -- cli script
        console.log(`${progress} [SKIP] ${account}: No Persona inquiry found`);
      } else if (inquiry.attributes.status !== "approved" && inquiry.attributes.status !== "completed") {
        results.push({
          account,
          credentialId,
          status: "skipped",
          reason: `Persona inquiry status: ${inquiry.attributes.status}`,
        });
        // eslint-disable-next-line no-console -- cli script
        console.log(
          `${progress} [SKIP] ${account}: Persona inquiry not approved (status: ${inquiry.attributes.status})`,
        );
      } else {
        // Fetch Persona account to get country code
        const personaAccount = await getAccount(credentialId);
        const countryCode =
          personaAccount?.attributes.fields.address?.value?.country_code?.value ??
          personaAccount?.attributes["country-code"];

        if (countryCode === "BD") {
          // We have issues with users in this country so we're skipping them entirely
          results.push({
            account,
            credentialId,
            status: "skipped",
            reason: "User is in Bangladesh",
          });
          // eslint-disable-next-line no-console -- cli script
          console.log(`${progress} [SKIP] ${account}: User is in Bangladesh`);
        } else {
          // Extract user data - these fields are guaranteed on approved/completed inquiries
          const capitaData = {
            firstName: inquiry.attributes["name-first"],
            lastName: inquiry.attributes["name-last"],
            birthdate: inquiry.attributes.birthdate,
            document: inquiry.attributes.fields["identification-number"]?.value ?? "",
            email: inquiry.attributes["email-address"],
            phone: inquiry.attributes["phone-number"],
            internalId: deriveAssociateId(account),
            product: "travel insurance",
          };

          if (dryRun) {
            // eslint-disable-next-line no-console -- cli script
            console.log(`${progress} [DRY-RUN] ${account}: Would add to Pax with data:`, {
              ...capitaData,
              document: maskPII(capitaData.document),
              email: maskPII(capitaData.email),
              phone: maskPII(capitaData.phone),
              countryCode,
            });
            results.push({ account, credentialId, status: "success", reason: "Dry run - would add to Pax" });
          } else {
            await addCapita(capitaData);
            // eslint-disable-next-line no-console -- cli script
            console.log(`${progress} [SUCCESS] Added ${account} to Pax`);
            results.push({ account, credentialId, status: "success" });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console -- cli script
      console.log(`${progress} [ERROR] ${account}: ${message}`);
      results.push({ account, credentialId, status: "error", reason: message });
    }

    if (delayMs > 0 && index < usersToProcess.length - 1) {
      await setTimeout(delayMs);
    }
  }

  return results;
}

function printSummary(results: BackfillResult[]): void {
  const success = results.filter((r) => r.status === "success").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;

  // eslint-disable-next-line no-console -- cli script
  console.log("\n--- Summary ---");
  // eslint-disable-next-line no-console -- cli script
  console.log(`Total processed: ${results.length}`);
  // eslint-disable-next-line no-console -- cli script
  console.log(`Success: ${success}`);
  // eslint-disable-next-line no-console -- cli script
  console.log(`Skipped: ${skipped}`);
  // eslint-disable-next-line no-console -- cli script
  console.log(`Errors: ${errors}`);

  if (errors > 0) {
    // eslint-disable-next-line no-console -- cli script
    console.log("\nErrors:");
    for (const result of results.filter((r) => r.status === "error")) {
      // eslint-disable-next-line no-console -- cli script
      console.log(`  - ${result.account}: ${result.reason}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const delayIndex = process.argv.indexOf("--delay");
  const delayArgument = delayIndex === -1 ? undefined : process.argv[delayIndex + 1];
  const delayMs = delayArgument ? Number.parseInt(delayArgument, 10) : 250;

  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    // eslint-disable-next-line no-console -- cli script
    console.log("Running in DRY-RUN mode - no changes will be made\n");
  }

  if (Number.isNaN(delayMs) || delayMs < 0) {
    throw new Error("Invalid delay");
  }

  const skipIndex = process.argv.indexOf("--skip");
  const skipArgument = skipIndex === -1 ? undefined : process.argv[skipIndex + 1];
  const skipCount = skipArgument ? Number.parseInt(skipArgument, 10) : 0;

  if (Number.isNaN(skipCount) || skipCount < 0) {
    throw new Error("Invalid skip count");
  }

  backfillPax(dryRun, delayMs, skipCount)
    .then((results) => {
      printSummary(results);

      // eslint-disable-next-line no-console -- cli script
      console.log("\nDone");
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console -- cli script
      console.error("Fatal error:", error);

      throw error;
    });
}
