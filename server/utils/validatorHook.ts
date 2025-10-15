import { captureException, setContext } from "@sentry/node";
import type createDebug from "debug";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { BaseSchema, BaseIssue, SafeParseResult } from "valibot";
import { flatten } from "valibot";

export default function validatorHook<
  TInput = unknown,
  TOutput = unknown,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
>({
  code = "bad request",
  debug,
  filter,
  status = 400,
}: {
  code?: string;
  debug?: ReturnType<typeof createDebug>;
  filter?: (result: TOutput) => boolean | undefined;
  status?: ContentfulStatusCode;
} = {}) {
  return (result: SafeParseResult<BaseSchema<TInput, TOutput, TIssue>>, c: Context) => {
    if (debug?.enabled && (!result.success || !filter || filter(result.output))) {
      c.req
        .text()
        .then(debug)
        .catch((error: unknown) => captureException(error));
    }
    if (!result.success) {
      captureException(new Error(code), {
        contexts: { validation: { ...result, flatten: flatten(result.issues) } },
      });
      setContext("validation", result);
      return c.json(
        {
          code,
          legacy: code,
          message: result.issues.length > 0 ? buildIssueMessages(result.issues) : undefined,
        },
        status,
      );
    }
  };
}

/** recursively builds human-readable error messages from valibot validation issues */
function buildIssueMessages(issues: BaseIssue<unknown>[], depth = 0, maxDepth = 5): string[] {
  const messages: string[] = [];
  for (const issue of issues) {
    const pathString = issue.path?.map((pathItem) => pathItem.key).join("/") ?? "";
    const message = pathString ? `${pathString} ${issue.message}` : issue.message;
    messages.push(message);
    if (issue.issues && Array.isArray(issue.issues) && depth < maxDepth) {
      messages.push(...buildIssueMessages(issue.issues, depth + 1, maxDepth));
    }
  }
  return messages;
}
