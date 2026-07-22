import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import { name } from "./job";
import worker from "./worker";
import supervise, { own } from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";
import { connect } from "../worker";

const kms = new KeyManagementServiceClient();
const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([secret("redis-url", secrets).then((url) => connect(url)), signer("allower", kms)]).then(
    ([bullmq, allower]) =>
      own(
        worker({ allower, bullmq }),
        () => bullmq.quit(),
        () => kms.close(),
        () => secrets.close(),
      ),
  ),
);
