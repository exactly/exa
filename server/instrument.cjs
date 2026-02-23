const { consoleLoggingIntegration, extraErrorDataIntegration, init } = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

const domain = require("@exactly/common/domain");

const development = !process.env.APP_DOMAIN || process.env.APP_DOMAIN === "localhost";

init({
  dsn: process.env.SENTRY_DSN,
  release: require("./generated/release"),
  environment:
    {
      "web.exactly.app": "production",
      "sandbox.exactly.app": "sandbox",
      "base.exactly.app": "base",
      "base-sepolia.exactly.app": "base-sepolia",
    }[domain] ?? domain,
  tracesSampleRate: 1,
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
    if (!exception) return event;
    const error = hint.originalException;
    if (
      error instanceof Error &&
      typeof (/** @type {{ status?: unknown }} */ (error).status) === "number" &&
      !(event.fingerprint && event.fingerprint.length > 1)
    ) {
      event.fingerprint = ["{{ default }}", error.name, error.message];
    }
    if (
      event.fingerprint?.[0] === "{{ default }}" &&
      (exception.type === "ContractFunctionExecutionError" ||
        exception.type === "ContractFunctionRevertedError" ||
        exception.type === "BaseError")
    ) {
      /** @typedef {{ cause?: unknown; data?: { errorName?: string }; reason?: string; signature?: string }} RevertError */
      for (
        let revert = /** @type {RevertError | undefined} */ (hint.originalException);
        revert;
        revert = /** @type {RevertError | undefined} */ (revert.cause)
      ) {
        const reason = revert.data?.errorName ?? revert.reason ?? revert.signature;
        if (reason) {
          exception.type = reason;
          break;
        }
      }
    }
    return event;
  },
  beforeSendTransaction: (transaction) => (transaction.extra?.["exa.ignore"] ? null : transaction),
  spotlight: development,
});
