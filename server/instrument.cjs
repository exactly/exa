const { consoleLoggingIntegration, extraErrorDataIntegration, init } = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");
const { env } = require("node:process");

const stack = require("@exactly/common/stack");

const development = stack === "localhost";

/** @type {import("@sentry/node").NodeOptions} */
const config = {
  dsn: env.SENTRY_DSN,
  release: require("./generated/release"),
  environment: stack,
  tracesSampleRate: 1,
  strictTraceContinuation: true,
  streamGenAiSpans: false,
  profilesSampleRate: 1,
  attachStacktrace: true,
  maxValueLength: 8192,
  normalizeDepth: 69,
  enableLogs: true,
  integrations: [
    nodeProfilingIntegration(),
    extraErrorDataIntegration({ depth: 69 }),
    ...(development ? [consoleLoggingIntegration()] : []),
  ],
  beforeSend: (event, hint) => {
    const exception = event.exception?.values?.[0];
    if (
      exception &&
      (exception.type === "ContractFunctionExecutionError" ||
        exception.type === "ContractFunctionRevertedError" ||
        exception.type === "BaseError")
    ) {
      /** @typedef {{ cause?: unknown; data?: { errorName?: string }; reason?: string; signature?: string }} RevertError */
      for (
        let error = /** @type {RevertError | undefined} */ (hint.originalException);
        error;
        error = /** @type {RevertError | undefined} */ (error.cause)
      ) {
        const reason = error.data?.errorName ?? error.reason ?? error.signature;
        if (reason) {
          exception.type = reason;
          break;
        }
      }
    }
    for (
      let error = /** @type {{ cause?: unknown; query?: unknown } | undefined} */ (hint.originalException);
      error;
      error = /** @type {{ cause?: unknown; query?: unknown } | undefined} */ (error.cause)
    ) {
      if (typeof error.query === "string" && error.cause instanceof Error) {
        for (const value of event.exception?.values ?? []) {
          if (value.value?.startsWith("Failed query: ")) {
            value.type = "DrizzleQueryError";
            value.value = error.cause.message;
          }
        }
        break;
      }
    }
    const synthetic = event.exception?.values?.[0];
    if (event.message && synthetic?.mechanism?.synthetic && synthetic.stacktrace) {
      event.threads = { values: [{ stacktrace: synthetic.stacktrace, crashed: false, current: true }] };
      event.exception = undefined;
    }
    return event;
  },
  beforeSendTransaction: (transaction) => {
    if (transaction.extra?.["exa.ignore"]) return null;
    if (env.K_SERVICE) transaction.transaction = `${transaction.transaction} · ${env.K_SERVICE}`;
    return transaction;
  },
  spotlight: development,
};
init(config);

module.exports = config;
