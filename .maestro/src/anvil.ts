import type {
  Address,
  BlockIdentifier,
  BlockNumber,
  BlockTag,
  ExactPartial,
  Hash,
  Hex,
  Quantity,
  RpcTransactionReceipt,
  TransactionRequest,
} from "viem";

declare const output: { id?: number };

export default function anvil(
  method: "eth_call",
  params: readonly [transaction: ExactPartial<TransactionRequest>],
): Hex;
export default function anvil(
  method: "eth_getBalance",
  params: readonly [account: Address, block: BlockNumber<number> | BlockTag | BlockIdentifier],
): `0x${string}`;
export default function anvil(
  method: "eth_getTransactionCount",
  params: readonly [account: Address, block: BlockNumber<number> | BlockTag | BlockIdentifier],
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
