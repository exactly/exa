import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import supervise from "../../supervise";
import secret from "../../utils/secret";
import { connect } from "../../workers/worker";
import createChatHook from "../chat";

const secrets = new SecretManagerServiceClient();

supervise(
  "chat",
  Promise.all([
    secret("redis-url", secrets).then((redisUrl) => connect(redisUrl)),
    secret("whatsapp-phone-number-id", secrets),
    secret("chat-whatsapp-app-secret", secrets),
    secret("chat-whatsapp-verify-token", secrets),
  ]).then(([bullmq, whatsappFrom, whatsappSecret, whatsappVerifyToken]) =>
    createChatHook({
      bullmq,
      whatsappFrom,
      whatsappSecret,
      whatsappVerifyToken,
      close: () => Promise.all([bullmq.quit(), secrets.close()]),
    }),
  ),
);
