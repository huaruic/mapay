import Link from "next/link";
import { ArrowRight, Braces, Coins, ShieldCheck, Star } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Metric, SectionTitle, StatusPill } from "@/components/ui";
import { services } from "@/lib/mock-data";

export default function MarketplacePage() {
  const totalCalls = services.reduce((sum, s) => sum + s.calls, 0);
  const totalRevenueMon = services
    .reduce((sum, s) => sum + Number(s.revenue.replace(" MON", "")), 0)
    .toFixed(2);
  const avgRating = (
    services.reduce((sum, s) => sum + Number(s.rating), 0) / services.length
  ).toFixed(1);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Marketplace"
        title="所有链上 paid AI tools，一视同仁。"
        description="MVP 不提供搜索、筛选、排序。任何 Buyer Agent 都会读取完整列表后由 LLM 自主选择；本页就是它看到的全集。"
        action={<StatusPill>Open list</StatusPill>}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Listed tools" value={String(services.length)} icon={Braces} />
        <Metric label="Total calls" value={String(totalCalls)} icon={Coins} />
        <Metric label="Total revenue" value={`${totalRevenueMon} MON`} icon={ShieldCheck} />
        <Metric label="Average rating" value={avgRating} icon={Star} />
      </section>

      <section className="mt-6 panel-flat overflow-hidden">
        <div className="border-b border-[var(--line)] p-5">
          <SectionTitle label="All tools" title="完整无许可列表" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="bg-white text-left text-[var(--muted)]">
              <tr>
                <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Tool</th>
                <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Provider</th>
                <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Price</th>
                <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Calls</th>
                <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Rating</th>
                <th className="border-b border-[var(--line)] px-5 py-3 font-medium">Status</th>
                <th className="border-b border-[var(--line)] px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const Icon = service.icon;
                return (
                  <tr key={service.id} className="group bg-[var(--panel)] hover:bg-white">
                    <td className="border-b border-[var(--line)] px-5 py-4">
                      <Link href={`/marketplace/${service.id}`} className="flex items-start gap-3">
                        <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-[6px] bg-[var(--background)] text-[var(--green-dark)]">
                          <Icon size={18} />
                        </div>
                        <div>
                          <div className="font-semibold">{service.name}</div>
                          <div className="mono text-xs text-[var(--muted)]">{service.manifest}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4 text-[var(--muted)]">
                      {service.provider}
                    </td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{service.price}</td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{service.calls}</td>
                    <td className="mono border-b border-[var(--line)] px-5 py-4">{service.rating}</td>
                    <td className="border-b border-[var(--line)] px-5 py-4">
                      <StatusPill>{service.status}</StatusPill>
                    </td>
                    <td className="border-b border-[var(--line)] px-5 py-4 text-right">
                      <Link
                        href={`/marketplace/${service.id}`}
                        className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition group-hover:text-[var(--foreground)]"
                      >
                        Details
                        <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-6 max-w-3xl text-sm leading-6 text-[var(--muted)]">
        PRD §10 约束：MVP 阶段 marketplace 不提供任何搜索、标签筛选、价格或评分排序。Buyer Agent 必须读取完整列表，自主权衡。
      </p>
    </AppShell>
  );
}
