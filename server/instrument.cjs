const domain = require("@exactly/common/domain");
const { extraErrorDataIntegration, init } = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

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
  integrations: [nodeProfilingIntegration(), extraErrorDataIntegration({ depth: 69 })],
  spotlight: !process.env.APP_DOMAIN || process.env.APP_DOMAIN === "localhost",
  beforeSendTransaction: (transaction) => (transaction.extra?.["exa.ignore"] ? null : transaction),
});
