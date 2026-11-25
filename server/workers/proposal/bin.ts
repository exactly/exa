import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import { name } from "./job";
import worker from "./worker";
import supervise, { own } from "../../supervise";
import createOnesignal from "../../utils/onesignal";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";
import { connect } from "../worker";

const kms = new KeyManagementServiceClient();
const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("redis-url", secrets).then((url) => connect(url)),
    signer("executor", kms),
    secret("proposal-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
  ]).then(([bullmq, executor, onesignal]) =>
    own(
      worker({ bullmq, executor, onesignal }),
      () => bullmq.quit(),
      () => kms.close(),
      () => secrets.close(),
    ),
  ),
);
