import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";
import { connect } from "../worker";

const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("chat-anthropic-api-key", secrets),
    secret("redis-url", secrets).then((redisUrl) => connect(redisUrl)),
    secret("whatsapp-phone-number-id", secrets),
    secret("chat-whatsapp-access-token", secrets),
  ]).then(([anthropicKey, bullmq, whatsappFrom, whatsappToken]) =>
    worker({
      anthropicKey,
      bullmq,
      whatsappFrom,
      whatsappToken,
      close: () => Promise.all([bullmq.quit(), secrets.close()]),
    }),
  ),
);
