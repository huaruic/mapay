import Link from "next/link";
import { ArrowUpRight, BadgeCheck, Blocks, FileCheck2, Hash, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Metric, PrimaryButton, SectionTitle, StatusPill } from "@/components/ui";
import { deliverables, taskReceipts } from "@/lib/mock-data";

export default function TaskAuditPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Public audit trail"
        title="Task task-mkt-042 的支付与调用历史"
        description="第三方可以从 PaymentReceipt 事件、callId、inputHash 和 tool manifest 重构完整执行路径。这里是为评委准备的链上审计视图。"
        action={<StatusPill>Complete</StatusPill>}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Task cost" value="0.140 MON" icon={BadgeCheck} />
        <Metric label="Receipts" value="3" icon={Hash} />
        <Metric label="Tools used" value="2" icon={Blocks} />
        <Metric label="Reputation" value="+1" icon={ShieldCheck} />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="panel-flat overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <SectionTitle label="PaymentReceipt events" title="链上凭证" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead className="bg-white text-left text-[var(--muted)]">
                <tr>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Receipt</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Service</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Amount</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Call ID</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Input Hash</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Tx</th>
                </tr>
              </thead>
              <tbody>
                {taskReceipts.map((receipt) => (
                  <tr key={receipt.receipt} className="bg-[var(--panel)]">
                    <td className="mono border-b border-[var(--line)] px-5 py-4 font-semibold">{receipt.receipt}</td>
                    <td className="border-b border-[var(--line)] px-5 py-4">{receipt.service}</td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{receipt.amount}</td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{receipt.callId}</td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{receipt.inputHash}</td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">
                      <a className="inline-flex items-center gap-1 text-[var(--green-dark)]" href="https://testnet.monadexplorer.com" target="_blank">
                        {receipt.tx}
                        <ArrowUpRight size={13} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel-flat p-5">
          <SectionTitle label="Final deliverable" title="整合产物" />
          <div className="space-y-3">
            {deliverables.map((item) => (
              <div key={item.title} className="rounded-[6px] border border-[var(--line)] bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold">{item.title}</span>
                  <span className="mono text-xs text-[var(--muted)]">{item.time}</span>
                </div>
                <p className="text-sm leading-6 text-[var(--muted)]">{item.copy}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-[6px] border border-[var(--line)] bg-white p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <FileCheck2 size={17} className="text-[var(--green-dark)]" />
              Reputation Passport update
            </div>
            <div className="mono text-sm text-[var(--muted)]">TaskCompleted(agentId: 1, rating: 5, newReputation: 51)</div>
          </div>

          <Link href="/agents/1" className="mt-5 inline-flex">
            <PrimaryButton>Back to workspace</PrimaryButton>
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
