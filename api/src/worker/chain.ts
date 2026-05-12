// Worker-facing chain client interface.
//
// Real implementation will wrap viem WalletClient + the Marketplace ABI; that
// lives under api/src/chain/ (owned by another track). The Worker only needs
// the three writes it calls (startTask / pay / completeTask) plus a hook to
// look up whether a previously-broadcast tx has confirmed (used for the
// reconcile-after-crash path in §10.2).

export type Hex = `0x${string}`;

export interface PayResult {
  receiptId: Hex;
  stepIdx: number;
  txHash: Hex;
}

export interface StartTaskResult {
  onChainTaskId: Hex;
  txHash: Hex;
}

export interface ReconcileResult {
  /** true if the prior pay() tx made it on chain. */
  confirmed: boolean;
  /** When confirmed, the values that came back. */
  receiptId?: Hex;
  stepIdx?: number;
  reverted?: boolean;
}

export interface ChainClient {
  startTask(input: {
    agentId: string;
    prompt: string;
  }): Promise<StartTaskResult>;
  pay(input: {
    onChainTaskId: Hex;
    toolId: string;
    toolVersion: number;
    expectedPriceWei: string;
    inputHash: Hex;
  }): Promise<PayResult>;
  completeTask(input: {
    onChainTaskId: Hex;
    resultHash: Hex;
  }): Promise<{ txHash: Hex }>;
  /** Look up a prior tx_hash and report if pay() landed. */
  reconcilePayTx(txHash: Hex): Promise<ReconcileResult>;
}
