import Link from "next/link";
import { ArrowRight, BadgeCheck, Bot, CircleDollarSign, Gauge, Plus, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Field, Metric, PrimaryButton, SectionTitle, StatusPill } from "@/components/ui";
import { agents } from "@/lib/mock-data";

export default function AgentsPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="End User console"
        title="创建带预算边界的 Buyer Agents."
        description="End User 设定总预算和 max-per-call，资金进入协议托管账户。Start Task 之后 agent 无需任何人工确认。"
        action={
          <PrimaryButton>
            <Plus className="mr-2" size={16} />
            Create & Fund
          </PrimaryButton>
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Agents" value="2" icon={Bot} />
        <Metric label="Total balance" value="0.592 MON" icon={CircleDollarSign} />
        <Metric label="Completed tasks" value="10" icon={BadgeCheck} />
        <Metric label="Highest reputation" value="51" icon={Gauge} />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.85fr]">
        <div className="grid gap-4">
          {agents.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`} className="panel group p-5 transition hover:border-[var(--graphite)]">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold">{agent.name}</h2>
                    <StatusPill>{agent.status}</StatusPill>
                  </div>
                  <p className="max-w-2xl text-[var(--muted)]">{agent.goal}</p>
                </div>
                <ArrowRight className="text-[var(--muted)] transition group-hover:translate-x-1" />
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="panel-flat p-3">
                  <div className="text-xs text-[var(--muted)]">Balance</div>
                  <div className="mono mt-1 font-semibold">{agent.balance}</div>
                </div>
                <div className="panel-flat p-3">
                  <div className="text-xs text-[var(--muted)]">Max per call</div>
                  <div className="mono mt-1 font-semibold">{agent.maxPerCall}</div>
                </div>
                <div className="panel-flat p-3">
                  <div className="text-xs text-[var(--muted)]">Reputation</div>
                  <div className="mono mt-1 font-semibold">{agent.reputation}</div>
                </div>
                <div className="panel-flat p-3">
                  <div className="text-xs text-[var(--muted)]">Tasks</div>
                  <div className="mono mt-1 font-semibold">{agent.tasks}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="panel-flat p-5">
          <SectionTitle label="Create agent" title="Policy-Bounded Wallet" />
          <div className="grid gap-4">
            <Field label="Agent name" value="Marketing Agent" />
            <Field label="Goal" value="生成 3 条带配图的 SaaS 发布推文" />
            <Field label="Budget" value="0.500 MON" />
            <Field label="Max per call" value="0.150 MON" />
            <div className="rounded-[6px] border border-[var(--line)] bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={16} className="text-[var(--green-dark)]" />
                Protocol enforced
              </div>
              <p className="text-sm leading-6 text-[var(--muted)]">
                合约会拒绝超过 agent balance 或 max-per-call 的 `purchaseService`。LLM 只能计划，不能绕过预算。
              </p>
            </div>
            <PrimaryButton>Create & Fund on Monad</PrimaryButton>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
