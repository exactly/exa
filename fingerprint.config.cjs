const { env } = require("node:process");

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: ["ExpoConfigAll", "GitIgnore", "PackageJsonScriptsAll"],
  ignorePaths: ["package.json", "patches/*", "src/generated/versionCode.js"],
  extraSources: [
    { type: "contents", id: "APP_DOMAIN", contents: env.APP_DOMAIN ?? "" },
    { type: "contents", id: "NODE_ENV", contents: env.NODE_ENV ?? "" },
  ],
};
