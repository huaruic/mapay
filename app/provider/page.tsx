import Link from "next/link";
import { Activity, ArrowUpRight, Banknote, BadgeCheck, Plus, Power, Star } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Field, Metric, PrimaryButton, SecondaryButton, SectionTitle, StatusPill } from "@/components/ui";
import { services } from "@/lib/mock-data";

export default async function ProviderPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string }>;
}) {
  const { registered } = await searchParams;

  return (
    <AppShell>
      {registered === "1" ? (
        <div className="mb-6 flex items-start gap-3 rounded-[6px] border border-[var(--green-dark)] bg-white p-4">
          <BadgeCheck size={18} className="mt-0.5 text-[var(--green-dark)]" />
          <div>
            <div className="text-sm font-semibold">Tool registered on Monad ✓</div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              链上 finality 后会进入下方 tools 表格。Mock 演示状态，未真正广播交易。
            </p>
          </div>
        </div>
      ) : null}
      <PageHeader
        eyebrow="Provider console"
        title="注册、管理、提现你的 paid AI tools."
        description="Provider 只需要提供服务 endpoint 和 MCP-compatible schema；定价、发现、支付凭证、收入结算由协议层完成。"
        action={
          <div className="flex gap-2">
            <SecondaryButton>Withdraw 4.92 MON</SecondaryButton>
            <Link href="/provider/tools/new">
              <PrimaryButton>
                <Plus className="mr-2" size={16} />
                Register Tool
              </PrimaryButton>
            </Link>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Total revenue" value="10.20 MON" icon={Banknote} />
        <Metric label="Tool calls" value="220" icon={Activity} />
        <Metric label="Average rating" value="4.8" icon={Star} />
        <Metric label="Active tools" value="2 / 3" icon={Power} />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <div className="panel-flat overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <SectionTitle label="Tools" title="服务生命周期管理" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="bg-white text-left text-[var(--muted)]">
                <tr>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Tool</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Price</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Calls</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Revenue</th>
                  <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id} className="bg-[var(--panel)]">
                    <td className="border-b border-[var(--line)] px-5 py-4">
                      <div className="font-semibold">{service.name}</div>
                      <div className="mono text-xs text-[var(--muted)]">{service.manifest}</div>
                    </td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{service.price}</td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{service.calls}</td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{service.revenue}</td>
                    <td className="border-b border-[var(--line)] px-5 py-4">
                      <StatusPill>{service.status}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel-flat p-5">
          <div className="flex items-start justify-between gap-3">
            <SectionTitle label="Register tool" title="MCP-compatible manifest" />
            <Link
              href="/provider/tools/new"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--green-dark)] hover:underline"
            >
              Open full form
              <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="grid gap-4">
            <Field label="Service name" value="Copywriter Agent" />
            <Field label="Endpoint" value="https://agentpay.app/api/tools/copywriter" />
            <Field label="Price per call" value="0.030 MON" />
            <Field label="Payout address" value="0x91B4eE11fA2b63bC89c4E8c2a2117a21" />
            <Field
              label="Input / output schema"
              multiline
              value={'{"inputSchema":{"topic":"string","tone":"enum","count":"number"},"outputSchema":{"tweets":"string[]"}}'}
            />
            <Link href="/provider/tools/new">
              <PrimaryButton>Register on-chain</PrimaryButton>
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
