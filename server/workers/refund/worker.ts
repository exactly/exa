import { captureException } from "@sentry/node";
import { array, number, object, parse, tuple } from "valibot";
import { toHex } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain, { refunderAddress, usdcAddress } from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address, Hex } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import ServiceError from "../../utils/ServiceError";
import { getWallet } from "../../utils/wallet";
import createWorker, { connect } from "../worker";

export default function worker({
  pandaKey,
  pandaUrl,
  redisUrl,
}: {
  pandaKey: string;
  pandaUrl: string;
  redisUrl: string;
}) {
  return createWorker<Job>({
    attempts,
    bullmq: connect(redisUrl),
    failed(job, error) {
      captureException(error, {
        extra: { amount: job?.data.amount, attempts: job?.attemptsMade, id: job?.id, recipient: refunderAddress },
        level: "error",
        tags: { queue: name, job: job?.name },
      });
    },
    name,
    async process(job) {
      const wallet = await getWallet(`${stack}-refunder`);
      const response = await fetch(
        `${pandaUrl}/issuing/tenants/signatures/withdrawals?token=${parse(Address, chain.testnet ? "0x29684075a3C86ea11D9964BcAf0F956e801396bD" : usdcAddress)}&amount=${job.data.amount}&recipientAddress=${refunderAddress}&adminAddress=${wallet.account.address}&chainId=${chain.id}`,
        {
          headers: { "Api-Key": pandaKey, accept: "application/json", "content-type": "application/json" },
          method: "GET",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        const raw = await response.text();
        throw new ServiceError("Panda", response.status, raw, undefined, raw);
      }
      const { parameters } = parse(
        object({ parameters: tuple([Address, Address, number(), Address, number(), array(number()), Hex]) }),
        JSON.parse(new TextDecoder().decode(await response.arrayBuffer())),
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
