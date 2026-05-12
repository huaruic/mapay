import { defineChain } from "viem";

// Monad Testnet 链定义。
// 参考: https://docs.monad.xyz - chain id 10143, MON 18 decimals, ~1s block, sub-second finality.
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    // 多个公共 RPC 轮询：官方 (有时 TLS 问题) → Tatum (100 块/请求限) → Ankr (限制少)。
    // 浏览器从优先级第一个开始尝试；超时/失败后 viem 内部 retry 切下一个。
    default: {
      http: [
        "https://monad-testnet.gateway.tatum.io",
        "https://rpc.ankr.com/monad_testnet",
        "https://rpc.testnet.monad.xyz",
      ],
    },
    public: {
      http: [
        "https://monad-testnet.gateway.tatum.io",
        "https://rpc.ankr.com/monad_testnet",
      ],
    },
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
