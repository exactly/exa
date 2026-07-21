import { captureException, withScope } from "@sentry/node";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { marketUSDCAddress, previewerAbi, previewerAddress } from "@exactly/common/generated/chain";

import { attempts, name, type Job } from "./job";
import * as schema from "../../database/schema";
import { cards, credentials } from "../../database/schema";
import t from "../../i18n";
import createOnesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import createWorker, { connect } from "../worker";

export default function worker({
  onesignalKey,
  postgresUrl,
  redisUrl,
}: {
  onesignalKey: string;
  postgresUrl: string;
  redisUrl: string;
}) {
  const database = drizzle(postgresUrl, { schema });
  const onesignal = createOnesignal(onesignalKey);
  return createWorker<Job>({
    attempts,
    bullmq: connect(redisUrl),
    close: () => database.$client.end(),
    failed(job, error) {
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        captureException(error, {
          extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
          level: "error",
          tags: { queue: name, job: job?.name },
        });
      });
    },
    name,
    async process(job, span) {
      const markets = await publicClient.readContract({
        address: previewerAddress,
        functionName: "exactly",
        abi: previewerAbi,
        args: [job.data.account],
      });
      let auto = false;
      for (const { floatingDepositAssets, market } of markets) {
        if (floatingDepositAssets <= 0n) continue;
        if (market === marketUSDCAddress) {
          auto = false;
          break;
        }
        auto = true;
      }
      span.setAttribute("exa.autoCredit", auto);
      if (auto) {
        const credential = await database.query.credentials.findFirst({
          where: eq(credentials.account, job.data.account),
          columns: {},
          with: {
            cards: {
              columns: { id: true, mode: true },
              where: inArray(cards.status, ["ACTIVE", "FROZEN"]),
            },
          },
        });
        const card = credential?.cards[0];
        span.setAttribute("exa.card", card?.id);
        if (card?.mode === 0) {
          await database.update(cards).set({ mode: 1 }).where(eq(cards.id, card.id));
          span.setAttribute("exa.mode", 1);
          await onesignal
            .sendPushNotification({
              userId: job.data.account,
              headings: t("Credit mode activated"),
              contents: t("Your card is now in credit mode"),
            })
            .catch((error: unknown) => captureException(error));
        }
      }
    },
  });
}
