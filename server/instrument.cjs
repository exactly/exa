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
    if (
      exception &&
      event.fingerprint?.[0] === "{{ default }}" &&
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
  beforeSendTransaction: (transaction) => (transaction.extra?.["exa.ignore"] ? null : transaction),
  spotlight: development,
});
