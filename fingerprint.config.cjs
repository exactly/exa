/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: ["ExpoConfigAll", "GitIgnore", "PackageJsonScriptsAll"],
  ignorePaths: ["package.json", "patches/*", "src/generated/versionCode.js"],
};
