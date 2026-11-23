import { createConfiguration, DefaultApi, Notification } from "@onesignal/node-onesignal";
import { randomUUID } from "node:crypto";
import { v5, validate } from "uuid";
import { check, minEntries, nonEmpty, parseJson, pipe, record, safeParse, string } from "valibot";

export default function onesignal(apps: string) {
  const parsed = safeParse(Apps, apps);
  if (!parsed.success) throw new Error("invalid onesignal api keys");
  const clients = Object.entries(parsed.output).map(([appId, key]) => ({
    appId,
    api: new DefaultApi(createConfiguration({ restApiKey: key })),
  }));
  return { sendPushNotification };

  async function sendPushNotification({
    userId,
    headings,
    contents,
    idempotencyKey,
    topic,
    ttl,
  }: {
    contents: NonNullable<Notification["contents"]>;
    headings: NonNullable<Notification["headings"]>;
    idempotencyKey: string;
    topic?: string;
    ttl?: number;
    userId: string;
  }) {
    const key = topic === undefined ? undefined : v5(`https://exact.ly/push/${topic}`, v5.URL);
    const results = await Promise.allSettled(
      clients.map(async ({ appId, api }) => {
        const appKey = key === undefined ? undefined : v5(key, appId);
        const notification = new Notification();
        notification.app_id = appId;
        notification.target_channel = "push";
        notification.include_aliases = { external_id: [userId] };
        notification.headings = headings;
        notification.contents = contents;
        notification.idempotency_key = v5(idempotencyKey, appId);
        notification.web_push_topic = appKey ?? randomUUID();
        if (appKey !== undefined) notification.collapse_id = appKey;
        if (ttl !== undefined) notification.ttl = ttl;
        return api.createNotification(notification);
      }),
    );
    const errors = results.flatMap((result, index) =>
      result.status === "rejected" ? [new Error(`onesignal ${clients[index]?.appId}`, { cause: result.reason })] : [],
    );
    if (errors.length > 1) throw new AggregateError(errors, "onesignal");
    if (errors[0]) throw errors[0];
    return results.filter((result) => result.status === "fulfilled").map(({ value }) => value);
  }
}

const Apps = pipe(
  string(),
  parseJson(),
  record(
    pipe(
      string(),
      check((id) => validate(id)),
    ),
    pipe(string(), nonEmpty()),
  ),
  minEntries(1),
);
