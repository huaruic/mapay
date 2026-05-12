"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Coins,
  Loader2,
  Network,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Field, PrimaryButton, SecondaryButton, SectionTitle } from "@/components/ui";

const defaultSchema = `{
  "inputSchema": {
    "topic": "string",
    "tone": "enum",
    "count": "number"
  },
  "outputSchema": {
    "tweets": "string[]"
  }
}`;

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Phase = "idle" | "preparing" | "awaiting-signature" | "mining" | "done" | "error";

export default function NewToolPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Tx 确认后自动跳转
  if (mined && phase !== "done") {
    setPhase("done");
    setTimeout(() => router.push("/provider?registered=1"), 800);
  }

  async function ensureSignedIn(): Promise<void> {
    const me = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
    if (me.ok) return;
    if (!address) throw new Error("请先点右上 Connect Wallet 连接钱包");
    const nonceRes = await fetch(`${API_BASE}/api/auth/nonce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ address, uri: window.location.origin }),
    });
    if (!nonceRes.ok) throw new Error("/api/auth/nonce failed");
    const { message } = (await nonceRes.json()) as { message: string | null };
    if (!message) {
      throw new Error("SIWE message 为空——后端 SIWE_DOMAIN env 没设？查 api/.env");
    }
    const { signMessage } = await import("wagmi/actions");
    const { wagmiConfig } = await import("@/lib/wagmi");
    const signature = await signMessage(wagmiConfig, { message });
    const verify = await fetch(`${API_BASE}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ message, signature }),
    });
    if (!verify.ok) throw new Error("SIWE verify failed");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // eslint-disable-next-line no-console
    console.log("[register] submit fired, connected=%o, address=%o", isConnected, address);
    setErrorMsg(null);
    if (!isConnected || !address) {
      setErrorMsg(
        "请先连接钱包（右上角 Connect Wallet）。如果按钮已显示地址，可能是 hydration 未完成——硬刷一下。",
      );
      return;
    }

    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get("name") ?? "").trim(),
      description: String(fd.get("description") ?? "").trim(),
      endpoint: String(fd.get("endpoint") ?? "").trim(),
      priceMon: String(fd.get("priceMon") ?? "").trim(),
      payout: String(fd.get("payout") ?? address).trim(),
      schemaJson: String(fd.get("schemaJson") ?? "").trim() || undefined,
    };

    try {
      setPhase("preparing");
      await ensureSignedIn();

      const res = await fetch(`${API_BASE}/api/provider/tools/prepare-register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(detail.message ?? detail.error ?? "prepare-register failed");
      }
      const { calldata } = (await res.json()) as {
        calldata: { to: `0x${string}`; data: `0x${string}`; value: string };
      };

      setPhase("awaiting-signature");
      const hash = await sendTransactionAsync({
        to: calldata.to,
        data: calldata.data,
        value: BigInt(calldata.value),
      });
      setTxHash(hash);
      setPhase("mining");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[register] failed:", err);
      setErrorMsg(msg);
      setPhase("error");
    }
  }

  const submitting =
    phase === "preparing" ||
    phase === "awaiting-signature" ||
    phase === "mining" ||
    mining;
  const submitLabel =
    phase === "preparing"
      ? "Preparing calldata…"
      : phase === "awaiting-signature"
        ? "请在钱包中签名"
        : phase === "mining"
          ? "等待链上确认…"
          : phase === "done"
            ? "已上链 ✓"
            : "Register on Monad";

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href="/provider"
          className="inline-flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
        >
          <ArrowLeft size={14} />
          Back to provider console
        </Link>
      </div>

      <PageHeader
        eyebrow="Provider · Register tool"
        title="把 AI 服务上架成 MCP-compatible paid tool."
        description="表单字段对应链上 registerTool 调用：name + endpoint + schema hash + 单次价格 + payout 地址。提交时只发一笔 tx，无人工 review。"
      />

      {phase === "done" ? (
        <div className="mb-6 flex items-start gap-3 rounded-[6px] border border-[var(--green-dark)] bg-white p-4">
          <CheckCircle2 size={18} className="mt-0.5 text-[var(--green-dark)]" />
          <div>
            <div className="text-sm font-semibold">Tool registered on Monad ✓</div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Tx <span className="mono">{txHash}</span> confirmed. Redirecting…
            </p>
          </div>
        </div>
      ) : null}

      {errorMsg ? (
        <div className="mb-6 rounded-[6px] border border-[var(--danger)] bg-white p-4 text-sm text-[var(--danger)]">
          {errorMsg}
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="grid gap-6 xl:grid-cols-[1fr_0.7fr]"
      >
        <div className="grid gap-6">
          <section className="panel-flat p-5">
            <SectionTitle label="Step 1 · Basics" title="工具身份" />
            <div className="grid gap-4">
              <Field name="name" label="Tool name" value="Copywriter Agent" required />
              <Field
                name="description"
                label="Description"
                multiline
                value="生成营销推文、发布语气和 hashtag。"
                required
              />
            </div>
          </section>

          <section className="panel-flat p-5">
            <SectionTitle label="Step 2 · Endpoint & pricing" title="服务定位 + 定价" />
            <div className="grid gap-4">
              <Field
                name="endpoint"
                label="Endpoint URL"
                value="https://agentpay-echo.fly.dev/invoke"
                required
              />
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  name="priceMon"
                  label="Price per call (MON)"
                  value="0.030"
                  required
                />
                <Field
                  name="payout"
                  label="Payout address"
                  value={address ?? ""}
                  placeholder="0x... defaults to connected wallet"
                />
              </div>
            </div>
          </section>

          <section className="panel-flat p-5">
            <SectionTitle label="Step 3 · MCP schema" title="Input / output JSON Schema" />
            <Field name="schemaJson" label="Schema (JSON)" multiline value={defaultSchema} />
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              Backend 会对 JSON 字符串做 keccak256 写到链上 Tool.schemaHash；后续 Provider middleware
              会用同样 hash 校验调用时的 inputHash。
            </p>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-[6px] bg-[var(--graphite)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="mr-2 animate-spin" size={16} />
              ) : (
                <Network className="mr-2" size={16} />
              )}
              {submitLabel}
            </button>
            <Link href="/provider">
              <SecondaryButton>Cancel</SecondaryButton>
            </Link>
            {!isConnected ? (
              <span className="mono text-xs text-[var(--danger)]">
                未连钱包，提交会失败
              </span>
            ) : null}
          </div>
        </div>

        <aside className="grid h-fit gap-4 xl:sticky xl:top-24">
          <div className="panel-flat p-5">
            <SectionTitle label="What happens" title="链上注册流程" />
            <ol className="grid gap-3 text-sm leading-6 text-[var(--muted)]">
              <li className="flex gap-3">
                <span className="mono text-[var(--green-dark)]">1.</span>
                后端 SIWE 鉴权 + 用 viem 编码 `Marketplace.registerTool(...)` calldata。
              </li>
              <li className="flex gap-3">
                <span className="mono text-[var(--green-dark)]">2.</span>
                前端 wagmi 调用钱包签名并广播 tx；合约 emit `ToolRegistered(toolId, provider, price, version=1)`。
              </li>
              <li className="flex gap-3">
                <span className="mono text-[var(--green-dark)]">3.</span>
                Chain watcher 在 finality depth 后 upsert 进 marketplace 列表，刷新 `/marketplace` 立即可见。
              </li>
            </ol>
          </div>

          <div className="panel-flat p-5">
            <SectionTitle label="Reminders" title="协议层强制约束" />
            <div className="grid gap-3 text-sm leading-6">
              <div className="flex items-start gap-3">
                <ShieldCheck size={16} className="mt-1 text-[var(--green-dark)]" />
                <span>每次更新价格或 schema 都会自增 `version` 字段。</span>
              </div>
              <div className="flex items-start gap-3">
                <Wallet size={16} className="mt-1 text-[var(--green-dark)]" />
                <span>收入用 pull-payment 模型累加，Provider 主动 `withdrawProvider` 提取。</span>
              </div>
              <div className="flex items-start gap-3">
                <Coins size={16} className="mt-1 text-[var(--green-dark)]" />
                <span>Provider 与 End User 不暴露身份，只通过协议交互。</span>
              </div>
            </div>
          </div>
        </aside>
      </form>
    </AppShell>
  );
}
