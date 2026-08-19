import { literal, object, optional, parse, string } from "valibot";

export function encode(challenge: string, accountType?: "business") {
  return JSON.stringify({ challenge, ...(accountType ? { accountType } : {}) });
}

export function decode(value: string) {
  try {
    return parse(object({ challenge: string(), accountType: optional(literal("business")) }), JSON.parse(value));
  } catch (error) {
    if (error instanceof SyntaxError) return { challenge: value };
  }
}
