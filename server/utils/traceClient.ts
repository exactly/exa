import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { parse } from "valibot";
import {
  AccountStateConflictError,
  BaseError,
  type BlockNumber,
  type BlockTag,
  type CallParameters,
  createPublicClient,
  type FormattedTransactionRequest,
  formatTransactionRequest,
  type Hash,
  type Hex,
  http,
  InvalidAddressError,
  isAddress,
  numberToHex,
  type RpcAccountStateOverride,
  type RpcBlockOverrides,
  rpcSchema,
  type RpcStateMapping,
  type RpcStateOverride,
  type RpcTransactionRequest,
  StateAssignmentConflictError,
  type StateMapping,
  type StateOverride,
} from "viem";

import { captureRequests, Request } from "./publicClient";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");

export default createPublicClient({
  chain,
  rpcSchema: rpcSchema<RpcSchema>(),
  transport: http(`${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`, {
    async onFetchRequest(request) {
      captureRequests([parse(Request, await request.json())]);
    },
  }),
}).extend((client) => ({
  traceCall: async ({
    blockNumber,
    blockTag = "latest",
    ...call
  }: FormattedTransactionRequest<typeof chain> & Omit<CallParameters<typeof chain>, "account">) =>
    client.request({
      method: "debug_traceCall",
      params: [
        formatTransactionRequest(call),
        blockNumber ?? blockTag,
        {
          tracer: "callTracer",
          tracerConfig: { withLog: true },
          ...(call.stateOverride && { stateOverrides: serializeStateOverride(call.stateOverride) }),
        },
      ],
    }),
  traceTransaction: async (hash: Hash) =>
    client.request({
      method: "debug_traceTransaction",
      params: [hash, { tracer: "callTracer", tracerConfig: { withLog: true } }],
    }),
}));

export interface CallFrame {
  type: "CALL" | "CREATE" | "STATICCALL" | "DELEGATECALL";
  from: string;
  to: string;
  value?: Hex;
  gas: Hex;
  gasUsed: Hex;
  input: Hex;
  output?: Hex;
  error?: string;
  revertReason?: string;
  calls?: CallFrame[];
  logs?: {
    address: Hex;
    topics?: [] | [signature: Hash, ...args: Hash[]];
    data?: Hex;
    position: Hex;
  }[];
}

export type RpcSchema = [
  {
    Method: "debug_traceCall";
    Parameters:
      | [transaction: RpcTransactionRequest]
      | [transaction: RpcTransactionRequest, block: BlockNumber | BlockTag]
      | [
          transaction: RpcTransactionRequest,
          block: BlockNumber | BlockTag,
          (
            | { tracer: "callTracer"; tracerConfig: { onlyTopCall?: boolean; withLog?: boolean } }
            | { tracer: "prestateTracer"; tracerConfig: { diffMode?: boolean } }
          ) & { stateOverrides?: RpcStateOverride; blockOverrides?: RpcBlockOverrides; txIndex?: number },
        ];
    ReturnType: CallFrame;
  },
  {
    Method: "debug_traceTransaction";
    Parameters: [
      Hash,
      (
        | { tracer: "callTracer"; tracerConfig: { onlyTopCall?: boolean; withLog?: boolean } }
        | { tracer: "prestateTracer"; tracerConfig: { diffMode?: boolean } }
      ),
    ];
    ReturnType: CallFrame;
  },
];
function serializeStateOverride(parameters?: StateOverride) {
  if (!parameters) return;
  const rpcStateOverride: RpcStateOverride = {};
  for (const { address, ...accountState } of parameters) {
    if (!isAddress(address, { strict: false })) throw new InvalidAddressError({ address });
    if (rpcStateOverride[address]) throw new AccountStateConflictError({ address });
    rpcStateOverride[address] = serializeAccountStateOverride(accountState);
  }
  return rpcStateOverride;
}

function serializeAccountStateOverride({
  balance,
  nonce,
  state,
  stateDiff,
  code,
}: Omit<StateOverride[number], "address">) {
  const rpcAccountStateOverride: RpcAccountStateOverride = {};
  if (code !== undefined) rpcAccountStateOverride.code = code;
  if (balance !== undefined) rpcAccountStateOverride.balance = numberToHex(balance);
  if (nonce !== undefined) rpcAccountStateOverride.nonce = numberToHex(nonce);
  if (state !== undefined) rpcAccountStateOverride.state = serializeStateMapping(state);
  if (stateDiff !== undefined) {
    if (rpcAccountStateOverride.state) throw new StateAssignmentConflictError();
    rpcAccountStateOverride.stateDiff = serializeStateMapping(stateDiff);
  }
  return rpcAccountStateOverride;
}

function serializeStateMapping(stateMapping?: StateMapping) {
  if (!stateMapping || stateMapping.length === 0) return;
  return stateMapping.reduce<RpcStateMapping>((accumulator, { slot, value }) => {
    if (slot.length !== 66) throw new InvalidBytesLengthError({ size: slot.length, targetSize: 66, type: "hex" });
    if (value.length !== 66) throw new InvalidBytesLengthError({ size: value.length, targetSize: 66, type: "hex" });
    accumulator[slot] = value;
    return accumulator;
  }, {});
}
export class InvalidBytesLengthError extends BaseError {
  constructor({ size, targetSize, type }: { size: number; targetSize: number; type: "hex" | "bytes" }) {
    super(
      `${type.charAt(0).toUpperCase()}${type
        .slice(1)
        .toLowerCase()} is expected to be ${targetSize} ${type} long, but is ${size} ${type} long.`,
      { name: "InvalidBytesLengthError" },
    );
  }
}
