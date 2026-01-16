import { createConfiguration, DefaultApi, Notification } from "@onesignal/node-onesignal";

import appId from "@exactly/common/onesignalAppId";

const client = new DefaultApi(createConfiguration({ restApiKey: process.env.ONESIGNAL_API_KEY }));

// eslint-disable-next-line import/prefer-default-export -- library module
export async function sendPushNotification({
  userId,
  headings,
  contents,
}: {
  contents: NonNullable<Notification["contents"]>;
  headings: NonNullable<Notification["headings"]>;
  userId: string;
}) {
  if (!appId) return;

  const notification = new Notification();
  notification.app_id = appId;
  notification.target_channel = "push";
  notification.include_aliases = { external_id: [userId] };
  notification.headings = headings;
  notification.contents = contents;
  return client.createNotification(notification);
}
