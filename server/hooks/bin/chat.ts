import supervise from "../../supervise";
import secret from "../../utils/secret";
import chat from "../chat";

supervise(
  "chat",
  Promise.all([
    secret("chat-anthropic-api-key"),
    secret("chat-identity-key"),
    secret("chat-postgres-url"),
    secret("redis-url"),
    secret("whatsapp-phone-number-id"),
    secret("chat-whatsapp-app-secret"),
    secret("chat-whatsapp-access-token"),
    secret("chat-whatsapp-verify-token"),
  ]).then(
    ([
      anthropicKey,
      chatKey,
      postgresUrl,
      redisUrl,
      whatsappFrom,
      whatsappSecret,
      whatsappToken,
      whatsappVerifyToken,
    ]) =>
      chat({
        anthropicKey,
        chatKey,
        postgresUrl,
        redisUrl,
        whatsappFrom,
        whatsappSecret,
        whatsappToken,
        whatsappVerifyToken,
      }),
  ),
);
