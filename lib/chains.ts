import { defineChain } from "viem";

// Monad Testnet 链定义。
// 参考: https://docs.monad.xyz - chain id 10143, MON 18 decimals, ~1s block, sub-second finality.
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.monad.xyz"] },
    public: { http: ["https://rpc.testnet.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
  contracts: {
    multicall3: {
      // 已预部署在 Monad Testnet
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: true,
});
