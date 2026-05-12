"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BadgeCheck, Bot, CircleDollarSign, Gauge, Plus } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Metric, StatusPill } from "@/components/ui";
import {
  ApiError,
  agentStats,
  listAgents,
  type AgentDetail,
  type AgentStatsResponse,
} from "@/lib/api-end-user";

const PRIMARY_LINK_CLASS =
  "inline-flex items-center justify-center rounded-[6px] bg-[var(--graphite)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDetail[] | null>(null);
  const [stats, setStats] = useState<AgentStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, s] = await Promise.all([listAgents(), agentStats()]);
        if (cancelled) return;
        setAgents(a.agents);
        setStats(s);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setError("请连接钱包并登录后查看 agents.");
          setAgents([]);
          setStats({
            agents: 0,
            totalBalance: "0",
            completedTasks: 0,
            highestReputation: 0,
          });
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to load agents",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="End User console"
        title="创建带预算边界的 Buyer Agents."
        description="End User 设定总预算和 max-per-call，资金进入协议托管账户。Start Task 之后 agent 无需任何人工确认。"
        action={
          <Link href="/agents/new" className={PRIMARY_LINK_CLASS}>
            <Plus className="mr-2" size={16} />
            Create & Fund
          </Link>
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Agents" value={stats ? String(stats.agents) : "—"} icon={Bot} />
        <Metric
          label="Total balance"
          value={stats ? `${stats.totalBalance} MON` : "—"}
          icon={CircleDollarSign}
        />
        <Metric
          label="Completed tasks"
          value={stats ? String(stats.completedTasks) : "—"}
          icon={BadgeCheck}
        />
        <Metric
          label="Highest reputation"
          value={stats ? String(stats.highestReputation) : "—"}
          icon={Gauge}
        />
      </section>

      <section className="mt-6">
        {error && agents === null ? (
          <div className="panel-flat p-6 text-sm text-[var(--muted)]" role="alert">
            {error}
          </div>
        ) : agents === null ? (
          <div className="panel-flat p-6 text-sm text-[var(--muted)]">
            Loading your agents…
          </div>
        ) : agents.length === 0 ? (
          <div className="panel-flat grid gap-3 p-8 text-center">
            <div className="mono text-xs uppercase text-[var(--muted-2)]">No agents yet</div>
            <h2 className="text-2xl font-semibold">Create your first agent</h2>
            <p className="mx-auto max-w-md text-sm leading-6 text-[var(--muted)]">
              一笔交易同时完成 mint Passport NFT 和注入预算。之后 agent 自主在 marketplace 中支付并交付。
            </p>
            <div className="mt-2">
              <Link href="/agents/new" className={PRIMARY_LINK_CLASS}>
                <Plus className="mr-2" size={16} />
                Create & Fund on Monad
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {agents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="panel group p-5 transition hover:border-[var(--graphite)]"
              >
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
                    <div className="mono mt-1 font-semibold">{agent.balance} MON</div>
                  </div>
                  <div className="panel-flat p-3">
                    <div className="text-xs text-[var(--muted)]">Max per call</div>
                    <div className="mono mt-1 font-semibold">{agent.maxPerCall} MON</div>
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
        )}
      </section>
    </AppShell>
  );
}
