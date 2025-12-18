import createDebug from "debug";
import { inspect } from "node:util";
import { safeParse, ValiError, type InferOutput } from "valibot";

import * as persona from "../utils/persona";
import { buildIssueMessages } from "../utils/validatorHook";

const BATCH_SIZE = 10;

const debug = createDebug("migration:debug");
const log = createDebug("migration:log");
const warn = createDebug("migration:warn");
const unexpected = createDebug("migration:unexpected");

let reference: string | undefined;
let all = false;
let onlyLogs = false;
let initialNext: string | undefined;

const options = process.argv.slice(2);
for (const option of options) {
  switch (true) {
    case option.startsWith("--reference-id="):
      reference = option.split("=")[1];
      break;
    case option.startsWith("--all"):
      all = true;
      break;
    case option.startsWith("--only-logs"):
      log("Running in only logs mode");
      onlyLogs = true;
      break;
    case option.startsWith("--next="):
      initialNext = option.split("=")[1];
      break;
  }
}

main().catch((error: unknown) => {
  unexpected("❌ migration failed", inspect(error, { depth: null, colors: true }));
});

let migratedAccounts = 0;
let redactedAccounts = 0;
let redactedInquiries = 0;
let failedToRedactAccounts = 0;
let noApprovedInquiryAccounts = 0;
let unknownTemplates = 0;
let cryptomateTemplates = 0;
let pandaTemplates = 0;
let schemaErrors = 0;
let inquirySchemaErrors = 0;
let noReferenceIdAccounts = 0;
let totalAccounts = 0;

async function main() {
  if (all) {
    log("🔍 Processing all accounts");
  } else if (reference) {
    log(`🔍 Processing accounts with reference ID: ${reference}`);
  } else {
    unexpected("❌ please provide --reference-id=<id> or --all is required");
    throw new Error("missing --reference-id=<id> or --all");
  }

  let next = initialNext;
  let batch = 0;
  let retries = 0;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    try {
      log(
        `\n ----- Processing batch ${batch++} (Batch size: ${BATCH_SIZE}, next: ${next ?? "undefined"}) ${retries > 0 ? `(Retry ${retries})` : ""} -----`,
      );

      const accounts = await getAccounts(BATCH_SIZE, next ?? undefined, reference).catch((error: unknown) => {
        if (error instanceof ValiError) {
          unexpected(`❌ Failed process batch ${batch} due to schema errors. Aborting...`);
          unexpected("❌ Schema errors:", buildIssueMessages(error.issues));
          return { data: [], links: { next: null } };
        }
        throw error;
      });

      totalAccounts += accounts.data.length;
      log(`🔍 Found ${accounts.data.length} accounts`);

      for (const account of accounts.data) {
        try {
          if (!account.attributes["reference-id"]) {
            noReferenceIdAccounts++;
            warn(`Account ${account.id} has no reference id`);
            continue;
          }
          await processAccount(account.id, account.attributes["reference-id"]);
        } catch (error: unknown) {
          unexpected(
            `❌ Failed to process batch ${batch}, next: ${next ?? "undefined"}, account: ${account.id}/${account.attributes["reference-id"]} due to: ${inspect(error, { depth: null, colors: true })}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
      }

      next = accounts.data.at(-1)?.id;
      if (!next) break;
      retries = 0;
    } catch (error: unknown) {
      unexpected(`❌ Failed to process batch ${batch} due to: ${inspect(error, { depth: null, colors: true })}`);
      await Promise.resolve(setTimeout(() => undefined, 1000));
      retries++;
      if (retries >= 3) {
        unexpected(`❌ Failed to process batch ${batch} after 3 retries. Aborting...`);
        break;
      }
    }
  }

  log(`\n ----- Migration summary -----`);
  log(`🔍 Total accounts processed: ${totalAccounts}`);
  log(`🔍 Redacted inquiries: ${redactedInquiries}`);
  log(`🔍 No approved inquiry accounts, redaction needed: ${noApprovedInquiryAccounts}`);
  log(` ---------------------------------`);
  log(`✅ Migrated approved accounts: ${migratedAccounts}`);
  log(`♻️ Redacted accounts: ${redactedAccounts}`);
  log(`❌ Accounts failed to redact: ${failedToRedactAccounts}`);
  log(` ---------------------------------`);

  log(`\n ----- Approved accounts summary -----`);
  log(`🔍 Panda templates: ${pandaTemplates}`);
  log(`🚨 Schema errors: ${schemaErrors}`);
  log(`🚨 Inquiry schema errors: ${inquirySchemaErrors}`);
  log(` ---------------------------------`);

  log(`\n ----- Inquiry Statistics summary -----`);
  log(`🚨 Unknown templates: ${unknownTemplates}`);
  log(`⚰️ Cryptomate templates: ${cryptomateTemplates}`);
  log(`⚠️ No reference id accounts: ${noReferenceIdAccounts}`);
  log(` ----- Statistics summary -----`);
}

function getAccounts(limit: number, after?: string, referenceId?: string) {
  return persona.getUnknownAccounts(limit, after, referenceId);
}

function updateAccountFromInquiry(accountId: string, inquiry: InferOutput<typeof persona.PandaInquiryApproved>) {
  return persona.updateAccount(accountId, {
    rain_e_sign_consent: inquiry.attributes.fields["input-checkbox"].value,
    exa_card_tc:
      inquiry.attributes.fields["new-screen-2-2-input-checkbox"]?.value ??
      inquiry.attributes.fields["new-screen-input-checkbox-2"].value,
    privacy__policy: inquiry.attributes.fields["new-screen-input-checkbox"].value,
    account_opening_disclosure: inquiry.attributes.fields["new-screen-input-checkbox-4"]?.value ?? null,
  });
}

async function processAccount(accountId: string, referenceId: string) {
  const unknownInquiry = await persona.getUnknownApprovedInquiry(referenceId).catch((error: unknown) => {
    if (error instanceof ValiError) {
      unexpected(
        `❌ Failed to get unknown approved inquiry for account ${referenceId}/${accountId} due to schema errors`,
        buildIssueMessages(error.issues),
      );
      inquirySchemaErrors++;
      throw error;
    }
    throw error;
  });

  if (!unknownInquiry) {
    noApprovedInquiryAccounts++;
    log(`Account ${referenceId}/${accountId} has no approved inquiry. Redacting account...`);
    if (onlyLogs) return;
    await persona
      .redactAccount(accountId)
      .then(() => {
        log(`♻️ Account ${referenceId}/${accountId} redacted successfully`);
        redactedAccounts++;
      })
      .catch((error: unknown) => {
        unexpected(
          `❌ Account ${referenceId}/${accountId} redacting failed`,
          inspect(error, { depth: null, colors: true }),
        );
        failedToRedactAccounts++;
      });
    return;
  }

  if (unknownInquiry.attributes["redacted-at"]) {
    redactedInquiries++;
    log(`Inquiry ${referenceId}/${accountId} is redacted. Redacting account...`);
    if (onlyLogs) return;
    await persona
      .redactAccount(accountId)
      .then(() => {
        log(`♻️ Account ${referenceId}/${accountId} redacted successfully`);
        redactedAccounts++;
      })
      .catch((error: unknown) => {
        unexpected(
          `❌ Account ${referenceId}/${accountId} redacting failed`,
          inspect(error, { depth: null, colors: true }),
        );
        failedToRedactAccounts++;
      });
    return;
  }

  const isPandaTemplate = unknownInquiry.relationships["inquiry-template"]?.data.id === persona.PANDA_TEMPLATE;
  const isCryptomateTemplate =
    unknownInquiry.relationships["inquiry-template"]?.data.id === persona.CRYPTOMATE_TEMPLATE;

  if (isPandaTemplate) {
    pandaTemplates++;
    const pandaInquiry = safeParse(persona.PandaInquiryApproved, unknownInquiry);
    if (!pandaInquiry.success) {
      inquirySchemaErrors++;
      unexpected(
        `❌ Account ${referenceId}/${accountId} failed to parse panda inquiry`,
        buildIssueMessages(pandaInquiry.issues),
      );
      return;
    }
    debug(`✅ PANDA TEMPLATE: Account ${referenceId}/${accountId} has approved inquiry`);
    if (onlyLogs) return;
    await updateAccountFromInquiry(accountId, pandaInquiry.output);
    await persona.addDocument(pandaInquiry.output.attributes["reference-id"], {
      id_class: { value: pandaInquiry.output.attributes.fields["identification-class"].value },
      id_number: { value: pandaInquiry.output.attributes.fields["identification-number"].value },
      id_issuing_country: { value: pandaInquiry.output.attributes.fields["selected-country-code"].value },
      id_document_id: { value: pandaInquiry.output.attributes.fields["current-government-id"].value.id },
    });

    // validate basic scope
    const basicAccount = await persona.getAccount(referenceId, "basic").catch((error: unknown) => {
      if (error instanceof ValiError) {
        unexpected(
          `❌ Account ${referenceId}/${accountId} failed to get basic scope due to schema errors`,
          buildIssueMessages(error.issues),
        );
      } else {
        unexpected(
          `❌ Account ${referenceId}/${accountId} getting basic scope failed`,
          inspect(error, { depth: null, colors: true }),
        );
      }
    });

    if (!basicAccount) {
      schemaErrors++;
      return unexpected(`❌ Account ${referenceId}/${accountId} failed to get basic scope`);
    }
    log(`✅ PANDA TEMPLATE: Account ${referenceId}/${basicAccount.id} has been migrated and has a valid basic scope`);
    migratedAccounts++;
    return;
  }

  if (isCryptomateTemplate) {
    cryptomateTemplates++;
    warn(
      `⚰️ CRYPTOMATE TEMPLATE: Account ${referenceId} has approved inquiry of template ${unknownInquiry.relationships["inquiry-template"]?.data.id}`,
    );
    return;
  }

  unknownTemplates++;
  warn(
    `🚨 UNKNOWN TEMPLATE: Account ${referenceId} has an approved inquiry of template ${unknownInquiry.relationships["inquiry-template"]?.data.id}`,
  );
}
