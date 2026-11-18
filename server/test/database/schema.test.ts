import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type * as C from "@exactly/common/generated/chain";

describe("credentials", () => {
  it.each([
    { isBase: false, pandaId: "panda_id", otherPandaId: "bamboo_id" },
    { isBase: true, pandaId: "bamboo_id", otherPandaId: "panda_id" },
  ])("maps panda id to $pandaId when base is $isBase", async ({ isBase, pandaId, otherPandaId }) => {
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => ({
      ...(await importOriginal<typeof C>()),
      isBase,
    }));

    const { credentials } = await import("../../database/schema");

    expect(getTableColumns(credentials).pandaId.name).toBe(pandaId);
    expect(getTableColumns(credentials).otherPandaId.name).toBe(otherPandaId);
  });
});
