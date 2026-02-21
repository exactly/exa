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
  beforeSend: (event) => {
    const exception = event.exception?.values?.[0];
    const reason = event.fingerprint?.[1];
    if (
      exception &&
      reason &&
      event.fingerprint?.[0] === "{{ default }}" &&
      (exception.type === "ContractFunctionExecutionError" ||
        exception.type === "ContractFunctionRevertedError" ||
        exception.type === "BaseError")
    ) {
      exception.type = reason;
    }
    return event;
  },
  beforeSendTransaction: (transaction) => (transaction.extra?.["exa.ignore"] ? null : transaction),
  spotlight: development,
});
