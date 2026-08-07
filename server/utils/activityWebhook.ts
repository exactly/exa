import createDebug from "debug";
import { env } from "node:process";

const debug = createDebug("exa:activity");

if (!env.ALCHEMY_ACTIVITY_ID) debug("missing alchemy activity id");
export let webhookId = env.ALCHEMY_ACTIVITY_ID;

export function setWebhookId(id: string) {
  webhookId = id;
}
