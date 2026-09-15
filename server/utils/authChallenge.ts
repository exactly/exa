import {
  fallback,
  literal,
  object,
  optional,
  parse,
  parseJson,
  pipe,
  string,
  type BaseIssue,
  type OutputDataset,
} from "valibot";

export function encode(challenge: string, accountType?: "business") {
  return accountType ? JSON.stringify({ challenge, accountType }) : challenge;
}

export function decode(value: string) {
  return parse(
    pipe(
      fallback(pipe(string(), parseJson()), (dataset: OutputDataset<string, BaseIssue<unknown>>) => ({
        challenge: dataset.value,
      })),
      object({ challenge: string(), accountType: optional(literal("business")) }),
    ),
    value,
  );
}
