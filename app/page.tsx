import Link from "next/link";
import { ArrowRight, Bot, Coins, Network, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Metric, PrimaryButton, SectionTitle, StatusPill } from "@/components/ui";
import { services, stats } from "@/lib/mock-data";

export default function Home() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="MPP-aligned · Monad-native"
        title="Agents discover, pay, invoke, and remember."
        description="AgentPay Passport 是一个链上 paid AI service marketplace。Provider 上架 MCP-compatible tools，End User 创建带预算与单次上限的 Buyer Agent，由协议层强制执行 MON 支付约束。"
        action={<StatusPill>Protocol online</StatusPill>}
      />

      <section className="grid gap-4 md:grid-cols-4">
        {stats.map((stat) => (
          <Metric key={stat.label} {...stat} />
        ))}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Link href="/provider" className="panel group p-6 transition hover:border-[var(--graphite)]">
          <div className="mb-8 flex items-start justify-between">
            <div className="grid h-12 w-12 place-items-center rounded-[6px] bg-[var(--graphite)] text-[var(--green)]">
              <Coins size={24} />
            </div>
            <ArrowRight className="text-[var(--muted)] transition group-hover:translate-x-1" size={22} />
          </div>
          <div className="mono mb-2 text-xs font-semibold uppercase text-[var(--green-dark)]">Provider flow</div>
          <h2 className="text-2xl font-semibold">把 AI 能力注册成 paid tool</h2>
          <p className="mt-3 max-w-xl leading-7 text-[var(--muted)]">
            填写 endpoint、MCP schema、price-per-call 和 payout address，链上注册后立即进入 marketplace。
          </p>
        </Link>

        <Link href="/agents" className="panel group p-6 transition hover:border-[var(--graphite)]">
          <div className="mb-8 flex items-start justify-between">
            <div className="grid h-12 w-12 place-items-center rounded-[6px] bg-[var(--graphite)] text-[var(--cyan)]">
              <Bot size={24} />
            </div>
            <ArrowRight className="text-[var(--muted)] transition group-hover:translate-x-1" size={22} />
          </div>
          <div className="mono mb-2 text-xs font-semibold uppercase text-[var(--green-dark)]">End User flow</div>
          <h2 className="text-2xl font-semibold">创建 Policy-Bounded Buyer Agent</h2>
          <p className="mt-3 max-w-xl leading-7 text-[var(--muted)]">
            设置预算与 max-per-call，提交任务后 agent 自主发现、支付、调用和整合产物。
          </p>
        </Link>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="panel-flat p-5">
          <SectionTitle label="Protocol guardrails" title="MVP 不可破坏的约束" />
          <div className="space-y-3">
            {[
              "Start Task 之后无人工确认",
              "预算和单次上限由合约拒绝超额消费",
              "Marketplace 展示完整 tool list，不做搜索筛选",
              "Provider 与 End User 只通过协议交互",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-[6px] border border-[var(--line)] bg-white p-3">
                <ShieldCheck size={18} className="text-[var(--green-dark)]" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-flat p-5">
          <SectionTitle label="Paid Tools Marketplace" title="完整列表预览" />
          <div className="grid gap-3">
            {services.map((service) => {
              const Icon = service.icon;
              return (
                <div key={service.id} className="grid gap-3 rounded-[6px] border border-[var(--line)] bg-white p-4 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <div className="grid h-10 w-10 place-items-center rounded-[6px] bg-[var(--background)] text-[var(--green-dark)]">
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className="font-semibold">{service.name}</div>
                    <div className="text-sm text-[var(--muted)]">{service.description}</div>
                  </div>
                  <div className="mono text-sm font-semibold">{service.price}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-5">
            <Link href="/agents/1">
              <PrimaryButton>
                Open execution workspace
                <ArrowRight className="ml-2" size={16} />
              </PrimaryButton>
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
