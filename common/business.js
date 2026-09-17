const domain = require("./domain");

module.exports = /** @type {boolean} */ (["business.exactly.app", "localhost"].includes(domain)); // TODO replace with business domains HACK localhost enables business for local testing
