import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { RedisStore } from "@mastra/redis";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";

import { name } from "./job";
import worker from "./worker";
import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import secret from "../../utils/secret";
import createWhatsapp from "../../utils/whatsapp";
import { connect } from "../worker";

const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("chat-anthropic-api-key", secrets),
    Promise.all([
      secret("chat-identity-key", secrets),
      Promise.resolve(parse(pipe(string("whatsapp id"), nonEmpty("whatsapp id")), env.WHATSAPP_PHONE_NUMBER_ID)),
      secret("chat-whatsapp-access-token", secrets),
    ]).then(([key, from, token]) => createWhatsapp({ from, key, token })),
    secret("chat-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    secret("redis-url", secrets).then(
      (url) => [connect(url), new RedisStore({ id: name, connectionString: url })] as const,
    ),
  ]).then(([anthropicKey, whatsapp, database, [bullmq, store]]) =>
    own(
      worker({ anthropicKey, bullmq, database, store, whatsapp }),
      () => bullmq.quit(),
      () => database.$client.end(),
      () => secrets.close(),
      () => store.close(),
    ),
  ),
);
