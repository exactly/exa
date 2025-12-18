import createDebug from "debug";

import * as persona from "../utils/persona";

const BATCH_SIZE = 10;

const debug = createDebug("migration:debug");
const log = createDebug("migration:log");
const warn = createDebug("migration:warn");
const unexpected = createDebug("migration:unexpected");

let id: string | undefined;
let all = false;
let onlyLogs = false;

const options = process.argv.slice(2);
for (const option of options) {
  switch (true) {
    case option.startsWith("--reference-id="):
      id = option.split("=")[1];
      break;
    case option.startsWith("--all"):
      all = true;
      break;
    case option.startsWith("--only-logs"):
      log("Running in only logs mode");
      onlyLogs = true;
      break;
  }
}

main(id, all).catch(unexpected);

async function main(accountReferenceId?: string, allAccounts?: boolean) {
  if (allAccounts) {
    log("🔍 Processing all accounts");
  } else if (accountReferenceId) {
    log(`🔍 Processing accounts with reference ID: ${accountReferenceId}`);
  } else {
    unexpected("❌ please provide --reference-id=<id> or --all is required");
    process.exit(1); // eslint-disable-line unicorn/no-process-exit, n/no-process-exit
  }

  let migratedAccounts = 0;
  let redactedAccounts = 0;
  let redactedInquiries = 0;
  let failedToRedactAccounts = 0;
  let noApprovedInquiryAccounts = 0;
  let unknownTemplates = 0;
  let cryptomateTemplates = 0;
  let pandaTemplates = 0;
  let schemaErrors = 0;
  let noReferenceIdAccounts = 0;
  let totalAccounts = 0;

  let next: string | undefined;
  let batch = 0;
  let pendingAccounts = true;
  while (pendingAccounts) {
    log(`\n ----- Processing batch ${batch++} (Batch size: ${BATCH_SIZE}) -----`);
    const accounts = await getAccounts(BATCH_SIZE, next ?? undefined, accountReferenceId);
    totalAccounts += accounts.data.length;
    log(`🔍 Found ${accounts.data.length} accounts`);

    for (const account of accounts.data) {
      const referenceId = account.attributes["reference-id"];
      if (!referenceId) {
        noReferenceIdAccounts++;
        warn(`Account ${account.id} has no reference id`);
        continue;
      }

      const inquiryApproved = await persona.getApprovedInquiry(referenceId);
      if (!inquiryApproved) {
        noApprovedInquiryAccounts++;
        log(`Account ${referenceId}/${account.id} has no approved inquiry. Redacting account...`);
        if (onlyLogs) continue;
        await persona
          .redactAccount(account.id)
          .then(() => {
            log(`♻️ Account ${referenceId} redacted successfully`);
            redactedAccounts++;
            migratedAccounts++;
          })
          .catch((error: unknown) => {
            unexpected(`❌ Account ${referenceId}/${account.id} redacting failed`, error);
            failedToRedactAccounts++;
          });
        continue;
      }

      if (inquiryApproved.attributes["redacted-at"]) {
        redactedInquiries++;
        log(`Inquiry ${referenceId}/${account.id} is redacted`);
        if (onlyLogs) continue;
        await persona
          .redactAccount(account.id)
          .then(() => {
            log(`♻️ Account ${referenceId}/${account.id} redacted successfully`);
            redactedAccounts++;
            migratedAccounts++;
          })
          .catch((error: unknown) => {
            unexpected(`❌ Account ${referenceId}/${account.id} redacting failed`, error);
            failedToRedactAccounts++;
          });
        continue;
      }

      const isPandaTemplate = inquiryApproved.relationships["inquiry-template"]?.data.id === persona.PANDA_TEMPLATE;
      const isCryptomateTemplate =
        inquiryApproved.relationships["inquiry-template"]?.data.id === persona.CRYPTOMATE_TEMPLATE;

      if (isPandaTemplate) {
        pandaTemplates++;
        // TODO push document ids
        persona
          .getAccount(referenceId, "basic")
          .then((basicAccount) => {
            if (!basicAccount) {
              schemaErrors++;
              return unexpected(`❌ Account ${referenceId}/${account.id} failed to get basic scope`);
            }
            debug(
              `✅ PANDA TEMPLATE: Account ${referenceId}/${basicAccount.id} has approved inquiry of template ${inquiryApproved.relationships["inquiry-template"]?.data.id}`,
            );
          })
          .catch((error: unknown) => {
            unexpected(`❌ Account ${referenceId}/${account.id} getting basic scope failed`, error);
            schemaErrors++;
          });
        continue;
      }

      if (isCryptomateTemplate) {
        cryptomateTemplates++;
        warn(
          `⚰️ CRYPTOMATE TEMPLATE: Account ${referenceId} has approved inquiry of template ${inquiryApproved.relationships["inquiry-template"]?.data.id}`,
        );
        continue;
      }

      unknownTemplates++;
      warn(
        `🚨 UNKNOWN TEMPLATE: Account ${referenceId} has an approved inquiry of template ${inquiryApproved.relationships["inquiry-template"]?.data.id}`,
      );
    }

    pendingAccounts = accounts.data.length === BATCH_SIZE;
    next = accounts.data.at(-1)?.id;
    if (!next) break;
  }

  log(`\n ----- Migration summary -----`);
  log(`🔍 Total accounts processed: ${totalAccounts}`);
  log(`🔍 Redacted inquiries: ${redactedInquiries}`);
  log(`🔍 No approved inquiry accounts, migration needed: ${noApprovedInquiryAccounts}`);
  log(`✅ Migrated accounts: ${migratedAccounts}`);
  log(`♻️ Redacted accounts: ${redactedAccounts}`);
  log(`❌ Accounts failed to redact: ${failedToRedactAccounts}`);
  log(` ---------------------------------`);

  log(`\n ----- Approved accounts summary -----`);
  log(`🔍 Panda templates: ${pandaTemplates}`);
  log(`🚨 Schema errors: ${schemaErrors}`);
  log(` ---------------------------------`);

  log(`\n ----- Statistics summary -----`);
  log(`⚠️ Unknown templates: ${unknownTemplates}`);
  log(`⚰️ Cryptomate templates: ${cryptomateTemplates}`);
  log(`⚠️ No reference id accounts: ${noReferenceIdAccounts}`);
  log(` ----- Statistics summary -----`);
}

function getAccounts(limit: number, after?: string, referenceId?: string) {
  return persona.getUnknownAccounts(limit, after, referenceId);
}
