import { describe, expect, it } from "vitest";

import { heldSince, hold } from "../../utils/hold";

describe("hold", () => {
  it("stays held until every overlapping hold settles", async () => {
    const first = Promise.withResolvers<null>();
    const second = Promise.withResolvers<null>();
    const pending = [first, second];
    const database = {
      query: { credentials: { findFirst: () => pending.shift()?.promise } },
    } as never;
    const segment = {} as never;

    const firstHold = hold({ database, segment }, "overlapping");
    const secondHold = hold({ database, segment }, "overlapping");
    second.resolve(null);
    await secondHold;

    expect(heldSince("overlapping", performance.now() + 1)).toBe(true);

    first.resolve(null);
    await firstHold;

    expect(heldSince("overlapping", performance.now() + 1)).toBe(false);
  });
});
