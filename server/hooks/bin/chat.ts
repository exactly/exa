import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Redis } from "ioredis";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";

import supervise, { own } from "../../supervise";
import secret from "../../utils/secret";
import createChatHook from "../chat";

const secrets = new SecretManagerServiceClient();

supervise(
  "chat",
  Promise.all([
    secret("redis-url", secrets).then((redisUrl) => new Redis(redisUrl, { maxRetriesPerRequest: 1 })),
    Promise.resolve(parse(pipe(string("whatsapp id"), nonEmpty("whatsapp id")), env.WHATSAPP_PHONE_NUMBER_ID)),
    secret("chat-whatsapp-app-secret", secrets),
    secret("chat-whatsapp-verify-token", secrets),
  ]).then(([redis, whatsappFrom, whatsappSecret, whatsappVerifyToken]) =>
    own(
      createChatHook({ redis, whatsappFrom, whatsappSecret, whatsappVerifyToken }),
      () => redis.quit(),
      () => secrets.close(),
    ),
  ),
);
