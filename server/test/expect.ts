import { expect } from "vitest";

expect.extend({
  withinRange: (received: bigint | number, floor: bigint | number, ceiling: bigint | number) => ({
    pass: received >= floor && received <= ceiling,
    message: () => `expected ${received} to be within range [${floor}, ${ceiling}]`,
  }),
});

type CustomMatchers<R = unknown> = {
  withinRange: (floor: bigint | number, ceiling: bigint | number) => R;
};

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-interface -- module augmentation requires interface merging
  interface Assertion<T> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-interface -- module augmentation requires interface merging
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
