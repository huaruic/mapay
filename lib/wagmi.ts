import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { monadTestnet } from "@/lib/chains";

// WalletConnect projectId 从 https://cloud.reown.com/ 申请（testnet 免费）。
// RainbowKit 把字面量 "YOUR_PROJECT_ID" 当作占位符，会替换成它自带的 example id；
// 这样 .env 没配时 SSR/prerender 仍能过——但生产环境必须配真实 id 才能用 WalletConnect。
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID";

export const wagmiConfig = getDefaultConfig({
  appName: "AgentPay Passport",
  projectId,
  chains: [monadTestnet],
  // Next.js App Router 需要 SSR-safe hydration（避免 window 访问 + cookie 持久化）。
  ssr: true,
});
