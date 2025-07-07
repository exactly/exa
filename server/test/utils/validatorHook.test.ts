import "../mocks/sentry";

import { captureException } from "@sentry/node";
import type { Debugger } from "debug";
import type { Context } from "hono";
import { object, string, safeParse, flatten, type InferOutput, optional, number } from "valibot";
import { describe, expect, it, vi, beforeEach } from "vitest";

import validatorHook from "../../utils/validatorHook";

vi.mock("@sentry/node", { spy: true });

function createMockContext(text = () => Promise.resolve("payload")) {
  return { req: { text }, json: vi.fn<() => void>() } as unknown as Context;
}

describe("validation error hook", () => {
  const mockContext = createMockContext();
  const mockText = vi.spyOn(mockContext.req, "text").mockResolvedValue("text-payload");
  const mockDebug = vi.fn<() => void>();
  const mockDebugger = Object.assign(mockDebug, { enabled: true });

  const TestSchema = object({
    name: string(),
    optional: optional(number()),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle successful validation with debug function", async () => {
    const hook = validatorHook({ debug: mockDebugger as unknown as Debugger });

    const result = safeParse(TestSchema, { name: "test" });
    hook(result, mockContext);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockText).toHaveBeenCalledWith();
    expect(mockDebug).toHaveBeenCalledWith("text-payload");
    expect(mockContext.json).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  describe("when the validation fails", () => {
    it("should debug payload and return 400 as default error code", async () => {
      const hook = validatorHook({ debug: mockDebugger as unknown as Debugger });

      const result = safeParse(TestSchema, { invalid: "data" });
      if (result.success) throw new Error("validation should fail"); // eslint-disable-line @vitest/no-conditional-in-test
      hook(result, mockContext);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockText).toHaveBeenCalledWith();
      expect(mockDebug).toHaveBeenCalledWith("text-payload");
      expect(captureException).toHaveBeenCalledWith(new Error("bad request"), {
        contexts: { validation: { ...result, flatten: flatten(result.issues) } },
      });
      expect(mockContext.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "bad request", legacy: "bad request" }),
        400,
      );
    });

    it("should capture exception and return 400 when captureException is provided", () => {
      const hook = validatorHook();

      const result = safeParse(TestSchema, { invalid: "data" });
      if (result.success) throw new Error("validation should fail"); // eslint-disable-line @vitest/no-conditional-in-test
      hook(result, mockContext);

      expect(captureException).toHaveBeenCalledWith(new Error("bad request"), {
        contexts: { validation: { ...result, flatten: flatten(result.issues) } },
      });
      expect(mockContext.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "bad request", legacy: "bad request" }),
        400,
      );
    });

    it("should return custom error code and message when provided", () => {
      const customErrorMessage = "custom error message";
      const hook = validatorHook({ code: customErrorMessage, status: 401 });

      const result = safeParse(TestSchema, { invalid: "data" });
      if (result.success) throw new Error("validation should fail"); // eslint-disable-line @vitest/no-conditional-in-test
      hook(result, mockContext);

      expect(mockContext.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: customErrorMessage, legacy: customErrorMessage }),
        401,
      );

      expect(captureException).toHaveBeenCalledWith(new Error(customErrorMessage), {
        contexts: { validation: { ...result, flatten: flatten(result.issues) } },
      });
    });

    it("should return issues in the response", () => {
      const hook = validatorHook();

      const result = safeParse(TestSchema, { invalid: "data" });
      if (!result.issues) throw new Error("validation should fail"); // eslint-disable-line @vitest/no-conditional-in-test

      hook(result, mockContext);

      expect(mockContext.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "bad request",
          legacy: "bad request",
          message: result.issues.map((issue) => `${issue.path?.map((p) => p.key).join("/")} ${issue.message}`),
        }),
        400,
      );
    });

    it("should not debug payload when filter is provided", async () => {
      const hook = validatorHook({ filter: (output: InferOutput<typeof TestSchema>) => output.name === "test" });

      const result = safeParse(TestSchema, { name: "test", optional: "data" });
      if (!result.issues) throw new Error("validation should fail"); // eslint-disable-line @vitest/no-conditional-in-test

      hook(result, mockContext);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockText).not.toHaveBeenCalled();
      expect(mockDebug).not.toHaveBeenCalled();
      expect(mockContext.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "bad request", legacy: "bad request" }),
        400,
      );
    });
  });
});
