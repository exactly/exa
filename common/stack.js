const domain = require("./domain");

let stack = [process.env.EXPO_PUBLIC_STACK, process.env.APP_STACK].find(Boolean);

if (!stack) {
  const match = /^([^.]+)\.exactly\.app$/.exec(domain);
  if (domain === "localhost") stack = "localhost";
  else if (domain === "web.exactly.app") stack = "production";
  else if (match) stack = match[1];
  else throw new Error("missing app stack");
}

module.exports = /** @type {string} */ (stack);
