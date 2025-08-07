import { MATURITY_INTERVAL } from "@exactly/lib";
import { Queue } from "bullmq";

import redis from "../utils/redis";

Promise.resolve()
  .then(async () => {
    for await (const keys of redis.scanStream({ match: "bull:*", count: 666 })) {
      if ((keys as string[]).length > 0) await redis.del(keys as string[]);
    }

    // const now = Date.now();
    // const oneDay = 24 * 60 * 60 * 1000;
    // const every = MATURITY_INTERVAL * 1000;
    // const startDate = new Date(now - (now % every) + every - day);
    // console.log(startDate);

    const queue = new Queue("accounts", { connection: redis });

    const every = MATURITY_INTERVAL * 1000;
    const offset = -24 * 60 * 60 * 1000;
    const firstRunAt = Math.ceil(Date.now() / every) * every + offset;
    console.log(new Date(firstRunAt - every));
    await queue.upsertJobScheduler("maturity", { every, offset, startDate: firstRunAt - every });

    for (const scheduler of await queue.getJobSchedulers()) {
      console.log(scheduler);
      if (scheduler.next) console.log(new Date(scheduler.next));
    }
    for (const job of await queue.getJobs()) console.log(new Date(job.timestamp + job.delay));

    await redis.quit();
  })
  .catch(console.error);
