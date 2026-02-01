import {
  decodeFunctionResult,
  encodeFunctionData,
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
>(parameters: ReadContractParameters<abi, functionName, args>): ReadContractReturnType<abi, functionName, args> {
  const { address, functionName, abi, args } = parameters as ReadContractParameters;
  return decodeFunctionResult({
    functionName,
    args,
    abi,
    data: anvil("eth_call", [{ to: address, data: encodeFunctionData({ functionName, args, abi }) }]),
  }) as ReadContractReturnType<abi, functionName>;
}

export function writeContract<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
  args extends ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>,
>(
  parameters: Pick<WriteContractParameters<abi, functionName, args>, "abi" | "address" | "args" | "functionName">,
): WriteContractReturnType {
  const { address, functionName, abi, args } = parameters as Pick<
    WriteContractParameters,
    "abi" | "address" | "args" | "functionName"
  >;
  return anvil("eth_sendTransaction", [{ to: address, data: encodeFunctionData({ functionName, abi, args }) }]);
}

declare const output: { id?: number };

export default function anvil(method: "eth_blockNumber", params: readonly []): Hex;
export default function anvil(
  method: "eth_call",
  params: readonly [transaction: ExactPartial<TransactionRequest>],
): Hex;
export default function anvil(
  method: "eth_getBalance",
  params: readonly [account: Address, block: BlockIdentifier | BlockNumber<number> | BlockTag],
): `0x${string}`;
export default function anvil(
  method: "eth_getLogs",
  params: readonly [filter: { address?: Address; fromBlock?: Hex; toBlock?: Hex; topics?: (Hex | Hex[] | null)[] }],
): RpcLog[];
export default function anvil(
  method: "eth_getTransactionCount",
  params: readonly [account: Address, block: BlockIdentifier | BlockNumber<number> | BlockTag],
): Quantity;
export default function anvil(
  method: "eth_getTransactionReceipt",
  params: readonly [hash: Hash],
): ExactPartial<RpcTransactionReceipt> | null;
export default function anvil(method: "eth_sendTransaction", params: readonly [transaction: TransactionRequest]): Hash;
export default function anvil(
  method: "anvil_mine",
  params: readonly [count: number, interval: number | undefined],
): void;
export default function anvil(method: "anvil_setBalance", params: readonly [account: Address, balance: string]): void;
export default function anvil(method: string, params: readonly unknown[]) {
  output.id ??= 0;
  const response = http.post("http://localhost:8545", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params, jsonrpc: "2.0", id: output.id++ }),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.body}`);
  const { result } = JSON.parse(response.body) as { result: unknown };
  return result;
}
