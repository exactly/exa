import { captureException, withScope } from "@sentry/node";
import { parse } from "valibot";

import { firewallAbi, firewallAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import wallet from "../../utils/wallet";
import createPoke from "../poke/queue";
import createWorker, { connect } from "../worker";

import type { LocalAccount } from "viem";

export default function worker({ allower, redisUrl }: { allower: LocalAccount; redisUrl: string }) {
  const bullmq = connect(redisUrl);
  const poke = createPoke(bullmq);
  return createWorker<Job>({
    attempts,
    bullmq,
    close: poke.close,
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
    async process(job) {
      await wallet(allower).exaSend(
        { name: "firewall.allow", op: "exa.firewall", attributes: { account: job.data.account } },
        {
          address: parse(Address, firewallAddress),
          functionName: "allow",
          args: [job.data.account, true],
          abi: firewallAbi,
        },
        { ignore: [`AlreadyAllowed(${job.data.account})`] },
      );
      await poke.enqueue({
        account: job.data.account,
        assets: job.data.assets,
        chainId: job.data.chainId,
        factory: job.data.factory,
        origin: "allow",
        publicKey: job.data.publicKey,
        source: job.data.source,
      });
    },
  });
}
