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
  type TransactionReceipt,
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
  parameters: Pick<WriteContractParameters<abi, functionName, args>, "address" | "functionName" | "abi" | "args">,
): WriteContractReturnType {
  const { address, functionName, abi, args } = parameters as Pick<
    WriteContractParameters,
    "address" | "functionName" | "abi" | "args"
  >;
  return anvil("eth_sendTransaction", [{ to: address, data: encodeFunctionData({ functionName, abi, args }) }]);
}

export default function anvil(method: "eth_call", params: [transaction: ExactPartial<TransactionRequest>]): Hex;
export default function anvil(
  method: "eth_getBalance",
  params: [account: Address, block: BlockNumber<number> | BlockTag | BlockIdentifier],
): `0x${string}`;
export default function anvil(
  method: "eth_getTransactionCount",
  params: [account: Address, block: BlockNumber<number> | BlockTag | BlockIdentifier],
): Quantity;
export default function anvil(method: "eth_getTransactionReceipt", params: [hash: Hash]): TransactionReceipt | null;
export default function anvil(method: "eth_sendTransaction", params: [transaction: TransactionRequest]): Hash;
export default function anvil(method: "anvil_setBalance", params: [account: Address, balance: string]): null;
export default function anvil(method: string, params: unknown[]) {
  output.id ??= 0;
  const response = http.post("http://localhost:8545", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params, jsonrpc: "2.0", id: output.id++ }),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.body}`);
  const { result } = JSON.parse(response.body) as { result: unknown };
  return result;
}
