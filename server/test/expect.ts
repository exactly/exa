import { expect } from "vitest";

expect.extend({
  withinRange: (received: number | bigint, floor: number | bigint, ceiling: number | bigint) => ({
    pass: received >= floor && received <= ceiling,
    message: () => `expected ${received} to be within range [${floor}, ${ceiling}]`,
  }),
});

interface CustomMatchers<R = unknown> {
  withinRange: (floor: number | bigint, ceiling: number | bigint) => R;
}

declare module "vitest" {
  interface Assertion<T = any> extends CustomMatchers<T> {} // eslint-disable-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-explicit-any
  interface AsymmetricMatchersContaining extends CustomMatchers {} // eslint-disable-line @typescript-eslint/no-empty-interface
}
