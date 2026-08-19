import { createConfiguration, DefaultApi, Notification } from "@onesignal/node-onesignal";

import appId from "@exactly/common/onesignalAppId.web";

export default function onesignal(key: string) {
  const api = new DefaultApi(createConfiguration({ restApiKey: key }));
  return { sendPushNotification };

  async function sendPushNotification({
    userId,
    headings,
    contents,
    idempotencyKey,
    ttl,
  }: {
    contents: NonNullable<Notification["contents"]>;
    headings: NonNullable<Notification["headings"]>;
    idempotencyKey?: string;
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
    if (idempotencyKey !== undefined) notification.idempotency_key = idempotencyKey;
    if (ttl !== undefined) notification.ttl = ttl;
    return api.createNotification(notification);
  }
}
