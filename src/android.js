const { withAndroidManifest, createRunOncePlugin } = require("expo/config-plugins");

module.exports = createRunOncePlugin(
  (config) => {
    return withAndroidManifest(config, (exportedConfig) => {
      exportedConfig.modResults.manifest = {
        ...exportedConfig.modResults.manifest,
        queries: [
          {
            package: [
              { $: { "android:name": "com.wallet.crypto.trustapp" } }, // cspell:ignore trustapp
              { $: { "android:name": "io.metamask" } },
              { $: { "android:name": "me.rainbow" } },
              { $: { "android:name": "io.zerion.android" } }, // cspell:ignore zerion
              { $: { "android:name": "io.gnosis.safe" } },
              { $: { "android:name": "com.uniswap.mobile" } },
            ],
          },
        ],
      };
      return exportedConfig;
    });
  },
  "withAndroidManifestService",
  "1.0.0",
);
