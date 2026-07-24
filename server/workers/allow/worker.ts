import { captureException, withScope } from "@sentry/node";
import { parse } from "valibot";

import { firewallAbi, firewallAddress } from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import { getWallet } from "../../utils/wallet";
import { close as closePoke, enqueue as enqueuePoke, start as startPoke } from "../poke/queue";
import createWorker, { connect } from "../worker";

export default function worker({ redisUrl }: { redisUrl: string }) {
  const bullmq = connect(redisUrl);
  startPoke(bullmq);
  return createWorker<Job>({
    attempts,
    bullmq,
    close: closePoke,
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
      const wallet = await getWallet(`${stack}-allower`);
      await wallet.exaSend(
        { name: "firewall.allow", op: "exa.firewall", attributes: { account: job.data.account } },
        {
          address: parse(Address, firewallAddress),
          functionName: "allow",
          args: [job.data.account, true],
          abi: firewallAbi,
        },
        { ignore: [`AlreadyAllowed(${job.data.account})`] },
      );
      await enqueuePoke({
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
