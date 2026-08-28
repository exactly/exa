import { mkdirSync, readdirSync, writeFileSync } from "node:fs";

const links = [...new Set(routes("../src/app/(main)"))].sort().map((route) => `/${route}`); // eslint-disable-line unicorn/no-array-sort -- no es2023 lib

mkdirSync("generated", { recursive: true });
writeFileSync(
  "generated/links.js",
  `module.exports = /** @type {readonly string[]} */ (${JSON.stringify(links, undefined, 2)})\n`,
);

/** @param {string} directory */
function routes(directory) {
  /** @type {string[]} */
  const found = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const route = entry.name.replace(/(?:\.\w+)?\.[jt]sx?$/, "");
    if (!entry.isDirectory() && route === entry.name) return [];
    if (route === "index" || /^[+._]/.test(route)) return [];
    return route.startsWith("(") ? routes(`${directory}/${entry.name}`) : route;
  });
  return found;
}
