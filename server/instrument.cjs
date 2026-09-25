const { consoleLoggingIntegration, extraErrorDataIntegration, httpIntegration, init } = require("@sentry/node");
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
  traceLifecycle: "static",
  strictTraceContinuation: true,
  profileSessionSampleRate: 1,
  profileLifecycle: "trace",
  attachStacktrace: true,
  maxValueLength: 8192,
  normalizeDepth: 69,
  dataCollection: { cookies: { deny: ["credential_id", "session_token"] } },
  integrations: [
    httpIntegration({ ignoreIncomingRequests: (path) => !/^\/(?:api|hooks|\.well-known)(?:[/?]|$)/.test(path) }),
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
    return event;
  },
  beforeSendTransaction: (transaction) => {
    if (transaction.contexts?.trace?.data?.["exa.ignore"]) return null;
    if (env.K_SERVICE) transaction.transaction = `${transaction.transaction} · ${env.K_SERVICE}`;
    return transaction;
  },
  spotlight: development,
};
init(config);

module.exports = config;
