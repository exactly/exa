import type * as crypto from "@peculiar/webcrypto";
import type * as buffer from "buffer"; // eslint-disable-line unicorn/prefer-node-protocol -- polyfill module
import "fast-text-encoding";

/* eslint-disable @typescript-eslint/no-unnecessary-condition */

global.Buffer ??= (require("buffer") as typeof buffer).Buffer; // eslint-disable-line unicorn/prefer-module, unicorn/prefer-node-protocol
global.crypto ??= new (require("@peculiar/webcrypto") as typeof crypto).Crypto(); // eslint-disable-line unicorn/prefer-module

if (global.window) {
  // @ts-expect-error -- enough for mipd
  global.CustomEvent ??= class {}; // eslint-disable-line @typescript-eslint/no-extraneous-class
  global.window.addEventListener ??= () => undefined;
  global.window.removeEventListener ??= () => undefined;
  global.window.dispatchEvent ??= () => false;
}

/* eslint-enable @typescript-eslint/no-unnecessary-condition */
