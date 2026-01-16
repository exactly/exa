import { parse } from "valibot";
import {
  AccountStateConflictError,
  BaseError,
  createPublicClient,
  formatTransactionRequest,
  http,
  InvalidAddressError,
  isAddress,
  numberToHex,
  rpcSchema,
  StateAssignmentConflictError,
  type BlockNumber,
  type BlockTag,
  type CallParameters,
  type FormattedTransactionRequest,
  type Hash,
  type Hex,
  type RpcAccountStateOverride,
  type RpcBlockOverrides,
  type RpcStateMapping,
  type RpcStateOverride,
  type RpcTransactionRequest,
  type StateMapping,
  type StateOverride,
} from "viem";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

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

export type CallFrame = {
  calls?: CallFrame[];
  error?: string;
  from: string;
  gas: Hex;
  gasUsed: Hex;
  input: Hex;
  logs?: {
    address: Hex;
    data?: Hex;
    position: Hex;
    topics?: [] | [signature: Hash, ...args: Hash[]];
  }[];
  output?: Hex;
  revertReason?: string;
  to: string;
  type: "CALL" | "CREATE" | "DELEGATECALL" | "STATICCALL";
  value?: Hex;
};

export type RpcSchema = [
  {
    Method: "debug_traceCall";
    Parameters:
      | [
          transaction: RpcTransactionRequest,
          block: BlockNumber | BlockTag,
          { blockOverrides?: RpcBlockOverrides; stateOverrides?: RpcStateOverride; txIndex?: number } & (
            | { tracer: "callTracer"; tracerConfig: { onlyTopCall?: boolean; withLog?: boolean } }
            | { tracer: "prestateTracer"; tracerConfig: { diffMode?: boolean } }
          ),
        ]
      | [transaction: RpcTransactionRequest, block: BlockNumber | BlockTag]
      | [transaction: RpcTransactionRequest];
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
  constructor({ size, targetSize, type }: { size: number; targetSize: number; type: "bytes" | "hex" }) {
    super(
      `${type.charAt(0).toUpperCase()}${type
        .slice(1)
        .toLowerCase()} is expected to be ${targetSize} ${type} long, but is ${size} ${type} long.`,
      { name: "InvalidBytesLengthError" },
    );
  }
}
