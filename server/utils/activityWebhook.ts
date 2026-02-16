import createDebug from "debug";

const debug = createDebug("exa:activity");

if (!process.env.ALCHEMY_ACTIVITY_ID) debug("missing alchemy activity id");
export let webhookId = process.env.ALCHEMY_ACTIVITY_ID;

export function setWebhookId(id: string) {
  webhookId = id;
}
