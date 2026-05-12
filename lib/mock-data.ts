import {
  BadgeCheck,
  Bot,
  Braces,
  Coins,
  FileCheck2,
  Image,
  PencilLine,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

export const navItems = [
  { label: "Overview", href: "/" },
  { label: "Provider", href: "/provider" },
  { label: "Agents", href: "/agents" },
  { label: "Audit", href: "/tasks/task-mkt-042" },
];

export const services = [
  {
    id: "copywriter",
    name: "Copywriter Agent",
    provider: "0x91B4...7a21",
    price: "0.030 MON",
    calls: 128,
    revenue: "3.84 MON",
    rating: "4.9",
    status: "Active",
    icon: PencilLine,
    manifest: "mcp://agentpay/copywriter",
    schema: "{ topic, tone, count }",
    description: "生成营销推文、发布语气和 hashtag。",
  },
  {
    id: "image-generator",
    name: "Image Generator",
    provider: "0x48F2...bE8c",
    price: "0.055 MON",
    calls: 83,
    revenue: "4.56 MON",
    rating: "4.7",
    status: "Active",
    icon: Image,
    manifest: "mcp://agentpay/image",
    schema: "{ prompt, aspect_ratio }",
    description: "为内容工作流生成配图 URL。",
  },
  {
    id: "premium-copy-pro",
    name: "Premium Copy Pro",
    provider: "0x6E0c...19Df",
    price: "0.200 MON",
    calls: 9,
    revenue: "1.80 MON",
    rating: "4.8",
    status: "Skipped by policy",
    icon: Braces,
    manifest: "mcp://agentpay/premium-copy-pro",
    schema: "{ brief, brand_voice }",
    description: "高价长文案工具，用于展示 max-per-call 拒绝。",
  },
];

export const agents = [
  {
    id: "1",
    name: "Marketing Agent",
    goal: "生成 3 条带配图的 SaaS 发布推文",
    balance: "0.412 MON",
    maxPerCall: "0.150 MON",
    reputation: 51,
    tasks: 7,
    owner: "0xC843...b92D",
    status: "Ready",
  },
  {
    id: "2",
    name: "Research Agent",
    goal: "调研市场机会并输出摘要",
    balance: "0.180 MON",
    maxPerCall: "0.080 MON",
    reputation: 47,
    tasks: 3,
    owner: "0xC843...b92D",
    status: "Needs funding",
  },
];

export const timeline = [
  {
    label: "Discover marketplace",
    detail: "已读取 3 个 MCP-compatible paid tools",
    state: "done",
    icon: BadgeCheck,
  },
  {
    label: "Generate open-loop plan",
    detail: "计划 4 次调用，跳过 Premium Copy Pro",
    state: "done",
    icon: Bot,
  },
  {
    label: "Pay Copywriter Agent",
    detail: "PaymentReceipt #381 · 0.030 MON",
    state: "done",
    icon: Coins,
  },
  {
    label: "Invoke Image Generator",
    detail: "3 张图片生成中，callId 已上链",
    state: "active",
    icon: Image,
  },
  {
    label: "Synthesize deliverable",
    detail: "等待所有 tool 输出后整合",
    state: "pending",
    icon: FileCheck2,
  },
];

export const taskReceipts = [
  {
    receipt: "#381",
    service: "copywriter",
    amount: "0.030 MON",
    callId: "0x8d51a9...9f20",
    inputHash: "0x1c45...e8aa",
    tx: "0xa441...9c10",
  },
  {
    receipt: "#382",
    service: "image-generator",
    amount: "0.055 MON",
    callId: "0x2a09bf...13dd",
    inputHash: "0x93ac...72f1",
    tx: "0x731b...c829",
  },
  {
    receipt: "#383",
    service: "image-generator",
    amount: "0.055 MON",
    callId: "0xf81cd2...51aa",
    inputHash: "0x66bb...097d",
    tx: "0x41ef...1190",
  },
];

export const deliverables = [
  {
    title: "Launch tweet 01",
    copy: "Your AI workflow should not need five subscriptions. AgentPay Passport lets Buyer Agents discover, pay, and deliver on Monad.",
    time: "Tue 10:20",
    tag: "#Monad #AI",
  },
  {
    title: "Launch tweet 02",
    copy: "Pay per useful agent action. No monthly bundle, no mid-task signature loop, just policy-bounded execution.",
    time: "Tue 14:30",
    tag: "#AgentEconomy",
  },
  {
    title: "Launch tweet 03",
    copy: "A2A lets agents talk. AgentPay Passport lets agents transact, remember, and build reputation.",
    time: "Wed 09:10",
    tag: "#MCP #Payments",
  },
];

export const stats = [
  { label: "Marketplace tools", value: "3", icon: Braces },
  { label: "Agent balance", value: "0.412 MON", icon: WalletCards },
  { label: "Policy max call", value: "0.150 MON", icon: ShieldCheck },
  { label: "Reputation", value: "51", icon: BadgeCheck },
];
