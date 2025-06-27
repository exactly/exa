//FIXME import properly

export default [
  {
    type: "event",
    anonymous: false,
    inputs: [
      {
        name: "transactionId",
        internalType: "bytes32",
        type: "bytes32",
        indexed: true,
      },
      {
        name: "integrator",
        internalType: "string",
        type: "string",
        indexed: false,
      },
      {
        name: "referrer",
        internalType: "string",
        type: "string",
        indexed: false,
      },
      {
        name: "receiver",
        internalType: "address",
        type: "address",
        indexed: false,
      },
      {
        name: "fromAssetId",
        internalType: "address",
        type: "address",
        indexed: false,
      },
      {
        name: "toAssetId",
        internalType: "address",
        type: "address",
        indexed: false,
      },
      {
        name: "fromAmount",
        internalType: "uint256",
        type: "uint256",
        indexed: false,
      },
      {
        name: "toAmount",
        internalType: "uint256",
        type: "uint256",
        indexed: false,
      },
    ],
    name: "LiFiGenericSwapCompleted",
  },
] as const;
