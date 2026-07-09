import { captureException } from "@sentry/node";
import { parse, string } from "valibot";
import { toHex } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain, { refunderAddress } from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import createPanda from "../../utils/panda";
import { getWallet } from "../../utils/wallet";
import createWorker, { connect } from "../worker";

export default function worker({
  redisUrl,
  pandaKey,
  pandaUrl,
}: {
  pandaKey: string;
  pandaUrl: string;
  redisUrl: string;
}) {
  const { getWebhook, getWithdrawal } = createPanda(pandaKey, pandaUrl);
  return createWorker<Job>({
    attempts,
    bullmq: connect(redisUrl),
    failed(job, error) {
      captureException(error, {
        extra: { attempts: job?.attemptsMade, id: job?.id, recipient: refunderAddress },
        level: "error",
        tags: { queue: name, job: job?.name },
      });
    },
    name,
    async process(job, span) {
      const webhookId = parse(string(), job.id);
      span.setAttribute("panda.event", webhookId);
      const { requestBody } = await getWebhook(webhookId);
      if (requestBody.resource !== "transaction") throw new Error("unexpected resource");
      const { spend } = requestBody.body;
      const cents =
        spend.status === "reversed"
          ? -spend.authorizationUpdateAmount
          : spend.amount < 0
            ? -spend.amount
            : spend.authorizedAmount
              ? spend.authorizedAmount - spend.amount
              : undefined;
      if (cents === undefined || cents <= 0) throw new Error("refund amount not found");
      span.setAttribute("refund.amount", cents);
      const wallet = await getWallet(`${stack}-refunder`);
      const { parameters } = await getWithdrawal(
        BigInt(cents),
        parse(Address, refunderAddress),
        parse(Address, wallet.account.address),
      );
      await wallet.exaSend(
        { name: "panda.withdraw", op: "panda.withdraw", attributes: { account: refunderAddress } },
        {
          address: parse(
            Address,
            {
              [baseSepolia.id]: "0x54d02DcB38B76A67dC9368D8457D1F384B865c70",
              [optimismSepolia.id]: "0x4A6321D536a510cfE95A919DE869C4179bFb4856",
              [base.id]: "0x753Fb325Ca30f229E616eA8E6Eb620D0Bb29D0Df",
              [optimism.id]: "0x753Fb325Ca30f229E616eA8E6Eb620D0Bb29D0Df",
            }[chain.id],
          ),
          args: [
            parameters[0],
            parameters[1],
            BigInt(parameters[2]),
            parameters[3],
            BigInt(parameters[4]),
            toHex(Buffer.from(parameters[5])),
            parameters[6],
          ],
          abi: [
            {
              inputs: [
                { internalType: "address", name: "_collateralProxy", type: "address" },
                { internalType: "address", name: "_asset", type: "address" },
                { internalType: "uint256", name: "_amount", type: "uint256" },
                { internalType: "address", name: "_recipient", type: "address" },
                { internalType: "uint256", name: "_expiresAt", type: "uint256" },
                { internalType: "bytes32", name: "_salt", type: "bytes32" },
                { internalType: "bytes", name: "_signature", type: "bytes" },
              ],
              name: "withdrawAsset",
              outputs: [],
              stateMutability: "nonpayable",
              type: "function",
            },
          ],
          functionName: "withdrawAsset",
        },
      );
    },
  });
}
