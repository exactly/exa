import { captureException } from "@sentry/node";
import { parse, string } from "valibot";
import { encodeFunctionData, parseAbi, toHex, type LocalAccount } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain, { refunderAddress, simple7702AccountAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { attempts, name } from "./job";
import createPanda from "../../utils/panda";
import createWallet from "../../utils/wallet";
import createWorker, { connect } from "../worker";

export default function worker({
  issuer,
  pandaKey,
  pandaUrl,
  redisUrl,
  refunder,
}: {
  issuer: LocalAccount;
  pandaKey: string;
  pandaUrl: string;
  redisUrl: string;
  refunder: LocalAccount;
}) {
  const { getWebhook, getWithdrawal } = createPanda({ key: pandaKey, url: pandaUrl });
  const wallet = createWallet(refunder);

  return createWorker({
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
    ready: wallet.getDelegation({ address: refunder.address }).then(async (delegation) => {
      if (delegation === simple7702AccountAddress) return;
      const authorization = await wallet.signAuthorization({
        account: refunder,
        contractAddress: simple7702AccountAddress,
        executor: "self",
      });
      const hash = await wallet.sendTransaction({ authorizationList: [authorization], to: refunder.address });
      await wallet.waitForTransactionReceipt({ hash });
    }),
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
      const { parameters } = await getWithdrawal(
        BigInt(cents),
        parse(Address, refunderAddress),
        parse(Address, issuer.address),
      );
      await wallet.exaSend(
        { name: "panda.withdraw", op: "panda.withdraw", attributes: { account: refunderAddress } },
        {
          address: refunder.address,
          functionName: "executeBatch",
          abi: parseAbi(["function executeBatch((address target, uint256 value, bytes data)[] calls)"]),
          args: [
            [
              {
                data: encodeFunctionData({
                  abi: parseAbi([
                    "function withdrawAsset(address collateralProxy, address asset, uint256 amount, address recipient, uint256 expiresAt, bytes32 salt, bytes signature)",
                  ]),
                  args: [
                    parameters[0],
                    parameters[1],
                    BigInt(parameters[2]),
                    parameters[3],
                    BigInt(parameters[4]),
                    toHex(Buffer.from(parameters[5])),
                    parameters[6],
                  ],
                  functionName: "withdrawAsset",
                }),
                target: parse(
                  Address,
                  {
                    [baseSepolia.id]: "0x54d02DcB38B76A67dC9368D8457D1F384B865c70",
                    [optimismSepolia.id]: "0x4A6321D536a510cfE95A919DE869C4179bFb4856",
                    [base.id]: "0x753Fb325Ca30f229E616eA8E6Eb620D0Bb29D0Df",
                    [optimism.id]: "0x753Fb325Ca30f229E616eA8E6Eb620D0Bb29D0Df",
                  }[chain.id],
                ),
                value: 0n,
              },
            ],
          ],
        },
      );
    },
  });
}
