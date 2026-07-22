import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import { name } from "./job";
import worker from "./worker";
import supervise, { own } from "../../supervise";
import createOnesignal from "../../utils/onesignal";
import secret from "../../utils/secret";
import createSegment from "../../utils/segment";
import { signer } from "../../utils/wallet";
import { connect } from "../worker";

const kms = new KeyManagementServiceClient();
const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("redis-url", secrets).then((url) => connect(url)),
    secret("poke-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
    signer("poker", kms),
    secret("poke-segment-write-key", secrets).then((key) => createSegment(key)),
  ]).then(([bullmq, onesignal, poker, segment]) =>
    own(
      worker({ bullmq, onesignal, poker, segment }),
      () => bullmq.quit(),
      () => kms.close(),
      () => secrets.close(),
      () => segment.close(),
    ),
  ),
);
