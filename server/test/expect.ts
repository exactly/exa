import { expect } from "vitest";

expect.extend({
  withinRange: (received: bigint | number, floor: bigint | number, ceiling: bigint | number) => ({
    pass: received >= floor && received <= ceiling,
    message: () => `expected ${received} to be within range [${floor}, ${ceiling}]`,
  }),
});

type CustomMatchers = {
  withinRange: (floor: bigint | number, ceiling: bigint | number) => unknown;
};

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-interface, @typescript-eslint/no-unused-vars -- module augmentation requires interface merging
  interface Matchers<R, T> extends CustomMatchers {}
}
