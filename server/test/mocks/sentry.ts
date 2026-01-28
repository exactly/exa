import "../../instrument.cjs";

import { close } from "@sentry/node";
import { afterAll, vi } from "vitest";

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  startSpan: vi
    .fn()
    .mockImplementation((_context: unknown, callback: (span: unknown) => unknown) =>
      callback({ setStatus: vi.fn(), setAttribute: vi.fn(), setAttributes: vi.fn() }),
    ),
  addBreadcrumb: vi.fn(),
  close: vi.fn(),
  setUser: vi.fn(),
  setContext: vi.fn(),
  continueTrace: vi.fn(),
  getActiveSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), setAttributes: vi.fn(), setStatus: vi.fn() }),
  withScope: vi
    .fn()
    .mockImplementation((callback: (scope: unknown) => void) =>
      callback({ setContext: vi.fn(), setUser: vi.fn(), setTag: vi.fn() }),
    ),
  getTraceData: vi.fn().mockReturnValue({ "sentry-trace": "trace-id", baggage: "baggage-data" }),
  setExtra: vi.fn(),
  setTag: vi.fn(),
  SEMANTIC_ATTRIBUTE_SENTRY_OP: "sentry.op",
  SPAN_STATUS_ERROR: 2,
  SPAN_STATUS_OK: 1,
}));

afterAll(() => close());
