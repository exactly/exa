const dsn = require("@exactly/common/sentryDSN");
const { extraErrorDataIntegration, init } = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

init({
  dsn,
  release: require("@exactly/common/generated/release"),
  environment: process.env.NODE_ENV === "production" ? "production" : "development",
  tracesSampleRate: 1,
  profilesSampleRate: 1,
  attachStacktrace: true,
  maxValueLength: 8192,
  normalizeDepth: 69,
  integrations: [nodeProfilingIntegration(), extraErrorDataIntegration({ depth: 69 })],
  spotlight: !process.env.APP_DOMAIN || process.env.APP_DOMAIN === "localhost",
  beforeSendTransaction: (transaction) => (transaction.extra?.["exa.ignore"] ? null : transaction),
});
