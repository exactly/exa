import {
  decodeFunctionResult,
  deploylessCallViaBytecodeBytecode,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  parseAbi,
  sliceHex,
  toHex,
  type Abi,
  type Address,
  type BlockIdentifier,
  type BlockNumber,
  type BlockTag,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ExactPartial,
  type Hash,
  type Hex,
  type Quantity,
  type ReadContractParameters,
  type ReadContractReturnType,
  type RpcLog,
  type RpcTransactionReceipt,
  type TransactionRequest,
  type WriteContractParameters,
  type WriteContractReturnType,
} from "viem";

export function readContract<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, "pure" | "view">,
  const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
>(
  parameters: ReadContractParameters<abi, functionName, args>,
  network?: string,
): ReadContractReturnType<abi, functionName, args> {
  const { address, code, functionName, abi, args } = parameters as ReadContractParameters & { code?: Hex };
  const data = encodeFunctionData({ functionName, args, abi });
  return decodeFunctionResult({
    functionName,
    args,
    abi,
    data: anvil(
      "eth_call",
      [
        code
          ? {
              data: encodeDeployData({
                abi: parseAbi(["constructor(bytes, bytes)"]),
                bytecode: deploylessCallViaBytecodeBytecode,
                args: [code, data],
              }),
            }
          : { to: address, data },
      ],
      network,
    ),
  }) as ReadContractReturnType<abi, functionName>;
}

export function writeContract<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
  args extends ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>,
>(
  parameters: Pick<WriteContractParameters<abi, functionName, args>, "address" | "args" | "functionName"> & {
    abi: abi;
  },
  network?: string,
): WriteContractReturnType {
  const { address, functionName, abi, args } = parameters as Pick<
    WriteContractParameters,
    "abi" | "address" | "args" | "functionName"
  >;
  const from = sliceHex(keccak256(toHex(String(Math.random()))), 12);
  anvil("anvil_impersonateAccount", [from], network);
  anvil("anvil_setBalance", [from, String(10n ** 18n)], network);
  return anvil(
    "eth_sendTransaction",
    [{ from, to: address, data: encodeFunctionData({ functionName, abi, args }) }],
    network,
  );
}

declare const output: { id?: number };
const urls: Partial<Record<string, string>> = {};

export default function anvil(method: "eth_blockNumber" | "eth_chainId", params: readonly [], network?: string): Hex;
export default function anvil(
  method: "eth_call",
  params: readonly [transaction: ExactPartial<TransactionRequest>],
  network?: string,
): Hex;
export default function anvil(
  method: "eth_getBalance",
  params: readonly [account: Address, block: BlockIdentifier | BlockNumber<number> | BlockTag],
  network?: string,
): `0x${string}`;
export default function anvil(
  method: "eth_getCode",
  params: readonly [account: Address, block: BlockIdentifier | BlockNumber<number> | BlockTag],
  network?: string,
): Hex;
export default function anvil(
  method: "eth_getLogs",
  params: readonly [filter: { address?: Address; fromBlock?: Hex; toBlock?: Hex; topics?: (Hex | Hex[] | null)[] }],
  network?: string,
): RpcLog[];
export default function anvil(
  method: "eth_getTransactionCount",
  params: readonly [account: Address, block: BlockIdentifier | BlockNumber<number> | BlockTag],
  network?: string,
): Quantity;
export default function anvil(
  method: "eth_getTransactionReceipt",
  params: readonly [hash: Hash],
  network?: string,
): ExactPartial<RpcTransactionReceipt> | null;
export default function anvil(
  method: "eth_sendTransaction",
  params: readonly [transaction: TransactionRequest],
  network?: string,
): Hash;
export default function anvil(
  method: "anvil_mine",
  params: readonly [count: number, interval: number | undefined],
  network?: string,
): void;
export default function anvil(
  method: "anvil_impersonateAccount",
  params: readonly [account: Address],
  network?: string,
): void;
export default function anvil(
  method: "anvil_setBalance",
  params: readonly [account: Address, balance: string],
  network?: string,
): void;
export default function anvil(method: string, params: readonly unknown[], network?: string) {
  const url = network
    ? (urls[network] ??= (
        JSON.parse(http.get("http://localhost:3000/e2e/lifi/v1/chains").body) as {
          chains: { metamask: { rpcUrls: string[] }; name: string }[];
        }
      ).chains.find(({ name }) => name === network)?.metamask.rpcUrls[0])
    : "http://localhost:8545";
  if (!url) throw new Error("unknown network");
  output.id ??= 0;
  const response = http.post(url, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params, jsonrpc: "2.0", id: output.id++ }),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.body}`);
  const { result, error } = JSON.parse(response.body) as { error?: { message: string }; result: unknown };
  if (error) throw new Error(error.message);
  return result;
}
