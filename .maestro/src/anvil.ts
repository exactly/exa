import type { Address, BlockNumber, BlockTag, BlockIdentifier } from "viem";

export default function anvil(
  method: "eth_getBalance",
  params: [account: Address, block: BlockNumber<number> | BlockTag | BlockIdentifier],
): `0x${string}`;
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
