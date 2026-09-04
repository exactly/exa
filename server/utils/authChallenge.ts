import { literal, object, optional, parse, string } from "valibot";

export function encode(challenge: string, accountType?: "business") {
  return accountType ? JSON.stringify({ challenge, accountType }) : challenge;
}

export function decode(value: string) {
  try {
    return parse(object({ challenge: string(), accountType: optional(literal("business")) }), JSON.parse(value));
  } catch (error) {
    return error instanceof SyntaxError ? { challenge: value } : undefined;
  }
}
