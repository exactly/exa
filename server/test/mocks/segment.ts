import { vi } from "vitest";

import type createSegment from "../../utils/segment";

type Segment = ReturnType<typeof createSegment>;

export const close = vi.fn<Segment["close"]>().mockResolvedValue();
export const identify = vi.fn<Segment["identify"]>();
export const track = vi.fn<Segment["track"]>();

vi.mock("../../utils/segment", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof createSegment }>();
  return { ...actual, default: () => ({ close, identify, track }) };
});
