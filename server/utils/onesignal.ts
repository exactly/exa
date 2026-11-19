import { createConfiguration, DefaultApi, Notification } from "@onesignal/node-onesignal";
import { randomUUID } from "node:crypto";
import { v5 } from "uuid";

import appId from "@exactly/common/onesignalAppId.web";

export default function onesignal(key: string) {
  const api = new DefaultApi(createConfiguration({ restApiKey: key }));
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
    if (!appId) return;
    const notification = new Notification();
    notification.app_id = appId;
    notification.target_channel = "push";
    notification.include_aliases = { external_id: [userId] };
    notification.headings = headings;
    notification.contents = contents;
    notification.idempotency_key = idempotencyKey;
    if (ttl !== undefined) notification.ttl = ttl;
    if (topic === undefined) {
      notification.web_push_topic = randomUUID();
    } else {
      notification.web_push_topic = v5(`https://exact.ly/push/${topic}`, v5.URL);
      notification.collapse_id = notification.web_push_topic;
    }
    return api.createNotification(notification);
  }
}
