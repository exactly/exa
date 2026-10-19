declare module "selenium-webdriver/common/driverFinder.js" {
  import type { Capabilities } from "selenium-webdriver";

  export function getBinaryPaths(capabilities: Capabilities): { browserPath?: string; driverPath: string }; // eslint-disable-line import/prefer-default-export -- mirrors the commonjs module
}
