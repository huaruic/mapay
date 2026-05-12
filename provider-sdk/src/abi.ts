// Minimal ABI subset used by @agentpay/provider-middleware.
// We DO NOT import the full Marketplace ABI here to keep the package
// dependency-light; only verifyAndConsumeReceipt is needed at request-time.

export const marketplaceAbi = [
  {
    type: "function",
    name: "verifyAndConsumeReceipt",
    inputs: [
      { name: "receiptId", type: "bytes32", internalType: "bytes32" },
      { name: "expectedInputHash", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [{ name: "ok", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;
