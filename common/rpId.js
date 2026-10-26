const domain = require("./domain");

module.exports = /** @type {string} */ (
  process.env.EXPO_PUBLIC_RP_ID || process.env.RP_ID || domain // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
);
