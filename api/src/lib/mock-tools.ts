// Mock marketplace data — replaced by chain-watcher cache once Marketplace.sol ships.
// Names/descriptions inspired by lib/mock-data.ts so frontend can swap mock→API cleanly.

export type Tool = {
  id: string;
  provider: `0x${string}`;
  name: string;
  description: string;
  priceWei: string;
  priceDisplay: string;
  version: number;
  schemaHash: `0x${string}`;
  endpoint: string;
  enabled: boolean;
  calls: number;
  rating: number | null;
};

// 1 MON = 1e18 wei (Monad uses 18 decimals like ETH)
const MON = (whole: string): string => {
  const [int, frac = ""] = whole.split(".");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(int + padded).toString();
};

export const MOCK_TOOLS: Tool[] = [
  {
    id: "1",
    provider: "0x91B4000000000000000000000000000000007a21",
    name: "Copywriter Agent",
    description: "生成营销推文、发布语气和 hashtag。",
    priceWei: MON("0.030"),
    priceDisplay: "0.030 MON",
    version: 1,
    schemaHash:
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    endpoint: "https://tools.example.com/copywriter",
    enabled: true,
    calls: 128,
    rating: 4.9,
  },
  {
    id: "2",
    provider: "0x48F200000000000000000000000000000000bE8c",
    name: "Image Generator",
    description: "为内容工作流生成配图 URL。",
    priceWei: MON("0.055"),
    priceDisplay: "0.055 MON",
    version: 1,
    schemaHash:
      "0x0000000000000000000000000000000000000000000000000000000000000002",
    endpoint: "https://tools.example.com/image",
    enabled: true,
    calls: 83,
    rating: 4.7,
  },
  {
    id: "3",
    provider: "0x6E0c0000000000000000000000000000000019Df",
    name: "Premium Copy Pro",
    description: "高价长文案工具，用于展示 max-per-call 拒绝。",
    priceWei: MON("0.200"),
    priceDisplay: "0.200 MON",
    version: 1,
    schemaHash:
      "0x0000000000000000000000000000000000000000000000000000000000000003",
    endpoint: "https://tools.example.com/premium-copy-pro",
    enabled: true,
    calls: 9,
    rating: 4.8,
  },
];
