"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Coins, Loader2, Network, ShieldCheck, Wallet } from "lucide-react";
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

export default function NewToolPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    // Mock: in real flow this fires `registerTool` on Monad and waits for finality.
    setTimeout(() => {
      router.push("/provider?registered=1");
    }, 600);
  }

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

      <form
        onSubmit={handleSubmit}
        className="grid gap-6 xl:grid-cols-[1fr_0.7fr]"
      >
        <div className="grid gap-6">
          <section className="panel-flat p-5">
            <SectionTitle label="Step 1 · Basics" title="工具身份" />
            <div className="grid gap-4">
              <Field label="Tool name" value="Copywriter Agent" />
              <Field
                label="Description"
                multiline
                value="生成营销推文、发布语气和 hashtag。"
              />
              <Field label="Manifest URI" value="mcp://agentpay/copywriter" />
            </div>
          </section>

          <section className="panel-flat p-5">
            <SectionTitle label="Step 2 · Endpoint & pricing" title="服务定位 + 定价" />
            <div className="grid gap-4">
              <Field
                label="Endpoint URL"
                value="https://agentpay.app/api/tools/copywriter"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Price per call (MON)" value="0.030" />
                <Field label="Payout address" value="0x91B4eE11fA2b63bC89c4E8c2a2117a21" />
              </div>
            </div>
          </section>

          <section className="panel-flat p-5">
            <SectionTitle label="Step 3 · MCP schema" title="Input / output JSON Schema" />
            <Field
              label="Schema (JSON)"
              multiline
              value={defaultSchema}
            />
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              Schema 由 protocol 端打上 IPFS hash 并写进 Tool struct；Provider middleware 在每次调用时本地比对 `keccak256(body)` 与 receipt 的 inputHash。
            </p>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 animate-spin" size={16} />
                  Broadcasting…
                </>
              ) : (
                <>
                  <Network className="mr-2" size={16} />
                  Register on Monad
                </>
              )}
            </PrimaryButton>
            <Link href="/provider">
              <SecondaryButton>Cancel</SecondaryButton>
            </Link>
            <span className="mono text-xs text-[var(--muted)]">
              MVP mock · 不会真正发送 tx
            </span>
          </div>
        </div>

        <aside className="grid h-fit gap-4 xl:sticky xl:top-24">
          <div className="panel-flat p-5">
            <SectionTitle label="What happens" title="链上注册流程" />
            <ol className="grid gap-3 text-sm leading-6 text-[var(--muted)]">
              <li className="flex gap-3">
                <span className="mono text-[var(--green-dark)]">1.</span>
                提交后前端 RPC 发送 `Marketplace.registerTool(...)`，钱包需签名一次。
              </li>
              <li className="flex gap-3">
                <span className="mono text-[var(--green-dark)]">2.</span>
                合约写入 Tool struct 并 emit `ToolRegistered(toolId, provider, price, version=1)`。
              </li>
              <li className="flex gap-3">
                <span className="mono text-[var(--green-dark)]">3.</span>
                Chain watcher 在 finality depth 后 upsert 进 marketplace 列表，立即可被 Buyer Agent 发现。
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
