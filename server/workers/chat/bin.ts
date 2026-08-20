import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";

import { name } from "./job";
import worker from "./worker";
import supervise, { own } from "../../supervise";
import secret from "../../utils/secret";
import createWhatsapp from "../../utils/whatsapp";
import { connect } from "../worker";

const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("chat-anthropic-api-key", secrets),
    secret("redis-url", secrets).then((redisUrl) => connect(redisUrl)),
    Promise.resolve(parse(pipe(string("whatsapp id"), nonEmpty("whatsapp id")), env.WHATSAPP_PHONE_NUMBER_ID)),
    secret("chat-whatsapp-access-token", secrets),
  ]).then(([anthropicKey, bullmq, whatsappFrom, whatsappToken]) =>
    own(
      worker({ anthropicKey, bullmq, whatsapp: createWhatsapp({ from: whatsappFrom, token: whatsappToken }) }),
      () => bullmq.quit(),
      () => secrets.close(),
    ),
  ),
);
