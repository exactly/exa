import { Hono } from "hono";

import supervise from "../../supervise";
import secret from "../../utils/secret";
import chat from "../chat";

const app = new Hono();

supervise(
  "chat",
  Promise.all([
    secret("chat-google-api-key"),
    secret("chat-whatsapp-api-key"),
    secret("chat-whatsapp-webhook-secret"),
  ]).then(([googleKey, whatsappKey, whatsappSecret]) => {
    const hook = chat({ googleKey, whatsappKey, whatsappSecret });
    app.route("/hooks/chat", hook.app);
    return hook;
  }),
  app,
);
