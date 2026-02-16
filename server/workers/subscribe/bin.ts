import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import { name } from "./job";
import worker from "./worker";
import supervise, { own } from "../../supervise";
import createAlchemy from "../../utils/alchemy";
import secret from "../../utils/secret";
import { connect } from "../worker";

const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("subscribe-alchemy-webhooks-key", secrets).then((key) => createAlchemy(key)),
    secret("redis-url", secrets).then((url) => connect(url)),
  ]).then(([alchemy, bullmq]) =>
    own(
      worker({ alchemy, bullmq }),
      () => bullmq.quit(),
      () => secrets.close(),
    ),
  ),
);
