import Link from "next/link";
import { ArrowRight, Copy, ExternalLink, ShieldCheck, Star } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PrimaryButton, SectionTitle, SecondaryButton, StatusPill } from "@/components/ui";
import { agents, deliverables, services, timeline } from "@/lib/mock-data";

export default function AgentWorkspacePage() {
  const agent = agents[0];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Agent execution workspace"
        title={`${agent.name} 正在执行任务`}
        description="Open-loop plan 已生成；每次 tool 调用前先写入 PaymentReceipt，wrapper 验证 receipt 后才执行真实 AI 服务。"
        action={<StatusPill>Autonomous run</StatusPill>}
      />

      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.15fr_1fr]">
        <aside className="panel-flat p-5">
          <SectionTitle label="Policy wallet" title="Agent state" />
          <div className="receipt-grid mb-5 rounded-[6px] border border-[var(--line)] bg-white p-4">
            <div className="mono text-xs text-[var(--muted)]">Passport NFT</div>
            <div className="mt-8 text-4xl font-semibold">#{agent.id}</div>
            <div className="mt-2 text-sm text-[var(--muted)]">{agent.owner}</div>
          </div>
          <div className="grid gap-3">
            {[
              ["Balance", agent.balance],
              ["Max per call", agent.maxPerCall],
              ["Reputation", String(agent.reputation)],
              ["Task history", `${agent.tasks} tasks`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                <span className="text-sm text-[var(--muted)]">{label}</span>
                <span className="mono font-semibold">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <SecondaryButton>Deposit</SecondaryButton>
            <SecondaryButton>Withdraw</SecondaryButton>
          </div>
        </aside>

        <section className="panel-flat p-5">
          <SectionTitle label="Task" title="生成 3 条带配图的 SaaS 发布推文" />
          <div className="mb-5 rounded-[6px] border border-[var(--line)] bg-white p-4">
            <div className="text-sm text-[var(--muted)]">Submitted prompt</div>
            <p className="mt-2 leading-7">
              为 AgentPay Passport 生成 3 条预热推文，每条包含文案、配图建议、发布时间和 hashtag。
            </p>
          </div>

          <div className="space-y-3">
            {timeline.map((step, index) => {
              const Icon = step.icon;
              const active = step.state === "active";
              return (
                <div key={step.label} className="grid grid-cols-[auto_1fr] gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`grid h-10 w-10 place-items-center rounded-[6px] border ${active ? "border-[var(--green)] bg-[rgba(40,214,127,0.12)] text-[var(--green-dark)]" : "border-[var(--line)] bg-white text-[var(--muted)]"}`}>
                      <Icon size={18} />
                    </div>
                    {index < timeline.length - 1 ? <div className="h-8 w-px bg-[var(--line)]" /> : null}
                  </div>
                  <div className="rounded-[6px] border border-[var(--line)] bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{step.label}</div>
                      <span className="mono text-xs text-[var(--muted)]">{step.state}</span>
                    </div>
                    <div className="mt-1 text-sm text-[var(--muted)]">{step.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-6">
          <div className="panel-flat p-5">
            <SectionTitle label="Marketplace" title="完整 tool list" />
            <div className="space-y-3">
              {services.map((service) => {
                const Icon = service.icon;
                return (
                  <div key={service.id} className="rounded-[6px] border border-[var(--line)] bg-white p-3">
                    <div className="flex items-start gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-[6px] bg-[var(--background)] text-[var(--green-dark)]">
                        <Icon size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold">{service.name}</div>
                          <div className="mono text-xs">{service.price}</div>
                        </div>
                        <div className="mono mt-1 text-xs text-[var(--muted)]">{service.schema}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel-flat p-5">
            <SectionTitle label="Deliverable" title="Tweet cards" />
            <div className="grid gap-3">
              {deliverables.map((item, index) => (
                <div key={item.title} className="rounded-[6px] border border-[var(--line)] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="mono text-xs text-[var(--muted)]">{item.title}</span>
                    <span className="mono text-xs text-[var(--green-dark)]">{item.time}</span>
                  </div>
                  <div className="mb-3 h-20 rounded-[6px] border border-[var(--line)] bg-[linear-gradient(135deg,#121612,#1f3f31_55%,#16c8d2)] p-3 text-white">
                    <div className="mono text-xs">image_url_{index + 1}.webp</div>
                  </div>
                  <p className="text-sm leading-6">{item.copy}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="mono text-xs text-[var(--muted)]">{item.tag}</span>
                    <button className="rounded-[6px] border border-[var(--line)] p-2 text-[var(--muted)] hover:text-[var(--foreground)]" aria-label="Copy tweet">
                      <Copy size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <PrimaryButton>
                <Star className="mr-2" size={16} />
                Rate 5 stars
              </PrimaryButton>
              <Link href="/tasks/task-mkt-042">
                <SecondaryButton>
                  Audit receipts
                  <ExternalLink className="ml-2" size={15} />
                </SecondaryButton>
              </Link>
            </div>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
