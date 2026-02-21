import { describe, expect, it } from "vitest";

import ServiceError from "../../utils/ServiceError";

describe("ServiceError", () => {
  describe("explicit type and detail", () => {
    it("uses provided type and detail", () => {
      const error = new ServiceError("Panda", 404, "raw", "NotFoundError", "Not Found");
      expect(error).toBeInstanceOf(ServiceError);
      expect(error.name).toBe("PandaNotFound");
      expect(error.message).toBe("Not Found");
      expect(error.status).toBe(404);
      expect(error.cause).toBe("raw");
    });

    it("strips Error suffix from type", () => {
      expect(new ServiceError("Panda", 403, "", "ForbiddenError").name).toBe("PandaForbidden");
    });

    it("falls back to status when type is exactly Error", () => {
      expect(new ServiceError("Panda", 400, "", "Error").name).toBe("Panda400");
    });

    it("preserves type without Error suffix", () => {
      expect(new ServiceError("Panda", 400, "", "BadRequest").name).toBe("PandaBadRequest");
    });

    it("falls back to status for empty string detail", () => {
      expect(new ServiceError("X", 500, undefined, undefined, "").message).toBe("500");
    });
  });

  describe("fallback without auto-parsing", () => {
    it("uses status as message and service+status as name when no type or detail", () => {
      const error = new ServiceError("Manteca", 500);
      expect(error.name).toBe("Manteca500");
      expect(error.message).toBe("500");
      expect(error.cause).toBeUndefined();
    });

    it("skips auto-parsing when cause is empty string", () => {
      const error = new ServiceError("Panda", 404, "");
      expect(error.name).toBe("Panda404");
      expect(error.message).toBe("404");
    });

    it("skips auto-parsing when cause is not a string", () => {
      const error = new ServiceError("X", 500, { some: "object" });
      expect(error.name).toBe("X500");
      expect(error.message).toBe("500");
    });

    it("skips auto-parsing when type is provided", () => {
      const error = new ServiceError("X", 400, '{"message":"ignored"}', "Custom");
      expect(error.name).toBe("XCustom");
      expect(error.message).toBe("400");
    });

    it("skips auto-parsing when detail is provided", () => {
      const error = new ServiceError("X", 400, '{"message":"ignored"}', undefined, "explicit");
      expect(error.name).toBe("X400");
      expect(error.message).toBe("explicit");
    });
  });

  describe("json auto-parsing", () => {
    it("extracts error field as type", () => {
      const error = new ServiceError("Panda", 400, '{"error":"BadRequestError","message":"invalid"}');
      expect(error.name).toBe("PandaBadRequest");
      expect(error.message).toBe("invalid");
    });

    it("skips error field when it is exactly Error", () => {
      const error = new ServiceError("Panda", 400, '{"error":"Error","message":"bad uuid"}');
      expect(error.name).toBe("Panda400");
      expect(error.message).toBe("bad uuid");
    });

    it("skips empty string error field", () => {
      const error = new ServiceError("X", 400, '{"error":"","message":"detail"}');
      expect(error.name).toBe("X400");
      expect(error.message).toBe("detail");
    });

    it("skips code field when it is exactly Error", () => {
      const error = new ServiceError("X", 400, '{"code":"Error","message":"detail"}');
      expect(error.name).toBe("X400");
      expect(error.message).toBe("detail");
    });

    it("extracts code ending in Error as type", () => {
      const error = new ServiceError("Pax", 400, '{"code":"SchemaError","err":"bad request"}');
      expect(error.name).toBe("PaxSchema");
      expect(error.message).toBe("bad request");
    });

    it("ignores code not ending in Error", () => {
      const error = new ServiceError("Bridge", 400, '{"code":"invalid_parameters","message":"resubmit"}');
      expect(error.name).toBe("Bridge400");
      expect(error.message).toBe("resubmit");
    });

    it("prefers error field over code field", () => {
      const error = new ServiceError("X", 400, '{"error":"CustomError","code":"SchemaError","message":"m"}');
      expect(error.name).toBe("XCustom");
    });

    it("extracts string message as detail", () => {
      const error = new ServiceError("Manteca", 400, '{"internalStatus":"BAD_REQUEST","message":"Bad request."}');
      expect(error.name).toBe("Manteca400");
      expect(error.message).toBe("Bad request.");
    });

    it("skips empty string message", () => {
      const error = new ServiceError("X", 400, '{"message":""}');
      expect(error.name).toBe("X400");
      expect(error.message).toBe("400");
    });

    it("skips non-string message (array)", () => {
      const error = new ServiceError("Pax", 400, '{"message":[{"keyword":"required"}],"err":"fallback"}');
      expect(error.message).toBe("fallback");
    });

    it("extracts errors[0].title as detail (persona format)", () => {
      const error = new ServiceError("Persona", 403, '{"errors":[{"title":"Too many sessions"}]}');
      expect(error.name).toBe("Persona403");
      expect(error.message).toBe("Too many sessions");
    });

    it("skips errors with empty title", () => {
      const error = new ServiceError("X", 400, '{"errors":[{"title":""}]}');
      expect(error.message).toBe("400");
    });

    it("skips errors with non-string title", () => {
      const error = new ServiceError("X", 400, '{"errors":[{"title":123}]}');
      expect(error.message).toBe("400");
    });

    it("skips empty errors array", () => {
      const error = new ServiceError("X", 400, '{"errors":[]}');
      expect(error.message).toBe("400");
    });

    it("falls back to err field when no message or errors[0].title", () => {
      const error = new ServiceError("Pax", 400, '{"err":"bad request"}');
      expect(error.message).toBe("bad request");
    });

    it("skips empty err field", () => {
      const error = new ServiceError("X", 400, '{"err":""}');
      expect(error.message).toBe("400");
    });

    it("prefers message over err", () => {
      const error = new ServiceError("X", 400, '{"message":"primary","err":"fallback"}');
      expect(error.message).toBe("primary");
    });

    it("ignores json arrays", () => {
      const error = new ServiceError("X", 400, "[1,2,3]");
      expect(error.name).toBe("X400");
      expect(error.message).toBe("400");
    });

    it("ignores json primitives", () => {
      const error = new ServiceError("X", 400, '"just a string"');
      expect(error.name).toBe("X400");
      expect(error.message).toBe("400");
    });

    it("extracts type without detail", () => {
      const error = new ServiceError("X", 404, '{"error":"NotFoundError"}');
      expect(error.name).toBe("XNotFound");
      expect(error.message).toBe("404");
    });
  });

  describe("html auto-parsing", () => {
    it("extracts title from nginx html", () => {
      const html = "<html><head><title>502 Bad Gateway</title></head><body></body></html>";
      const error = new ServiceError("Panda", 502, html);
      expect(error.name).toBe("Panda502");
      expect(error.message).toBe("502 Bad Gateway");
    });

    it("extracts title from cloudflare html", () => {
      const html =
        "<!DOCTYPE html><html><head><title>Worker threw exception | withpersona.com | Cloudflare</title></head></html>"; // cspell:ignore withpersona
      const error = new ServiceError("Persona", 500, html);
      expect(error.message).toBe("Worker threw exception | withpersona.com | Cloudflare");
    });

    it("extracts title case-insensitively", () => {
      const html = "<HTML><HEAD><TITLE>503 Service Unavailable</TITLE></HEAD></HTML>";
      const error = new ServiceError("X", 503, html);
      expect(error.message).toBe("503 Service Unavailable");
    });

    it("falls back to status for html without title", () => {
      const error = new ServiceError("X", 500, "<html><body>error</body></html>");
      expect(error.message).toBe("500");
    });
  });

  describe("plain text auto-parsing", () => {
    it("uses short plain text as detail", () => {
      const error = new ServiceError("Pax", 400, "Bad Request");
      expect(error.name).toBe("Pax400");
      expect(error.message).toBe("Bad Request");
    });

    it("falls back to status for text longer than 200 chars", () => {
      const error = new ServiceError("X", 500, "a".repeat(201));
      expect(error.message).toBe("500");
    });

    it("uses text at exactly 200 chars", () => {
      const text = "b".repeat(200);
      const error = new ServiceError("X", 500, text);
      expect(error.message).toBe(text);
    });

    it("falls back to status for text containing <", () => {
      const error = new ServiceError("X", 500, "error < something");
      expect(error.message).toBe("500");
    });
  });
});
