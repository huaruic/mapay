import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, Banknote, Coins, FileJson, Star, Zap } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Metric, PrimaryButton, SecondaryButton, SectionTitle, StatusPill } from "@/components/ui";
import { services, taskReceipts } from "@/lib/mock-data";

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ toolId: string }>;
}) {
  const { toolId } = await params;
  const service = services.find((s) => s.id === toolId);
  if (!service) notFound();

  const Icon = service.icon;
  const recentReceipts = taskReceipts.filter((r) => r.service === toolId);

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
        >
          <ArrowLeft size={14} />
          Back to marketplace
        </Link>
      </div>

      <PageHeader
        eyebrow="Tool detail"
        title={service.name}
        description={service.description}
        action={
          <div className="flex gap-2">
            <SecondaryButton>Copy manifest URI</SecondaryButton>
            <PrimaryButton>
              <Zap className="mr-2" size={16} />
              Use in agent
            </PrimaryButton>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Price per call" value={service.price} icon={Coins} />
        <Metric label="Calls" value={String(service.calls)} icon={Activity} />
        <Metric label="Revenue" value={service.revenue} icon={Banknote} />
        <Metric label="Rating" value={service.rating} icon={Star} />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <div className="panel-flat p-5">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-[6px] bg-[var(--background)] text-[var(--green-dark)]">
              <Icon size={22} />
            </div>
            <div className="flex-1">
              <div className="mono text-xs uppercase text-[var(--muted-2)]">Manifest URI</div>
              <div className="mono mt-1 text-sm">{service.manifest}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusPill>{service.status}</StatusPill>
                <span className="mono text-xs text-[var(--muted)]">Provider {service.provider}</span>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <SectionTitle label="MCP schema" title="Input / output 形态" />
            <pre className="overflow-x-auto rounded-[6px] border border-[var(--line)] bg-white p-4 text-sm leading-6">
              <code className="mono">{service.schema}</code>
            </pre>
            <p className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
              <FileJson size={14} />
              Schema 由合约存 IPFS hash，Provider 端 middleware 用同 hash 校验调用 body。
            </p>
          </div>
        </div>

        <div className="panel-flat p-5">
          <SectionTitle label="Recent calls" title="链上 receipt 证据" />
          {recentReceipts.length === 0 ? (
            <div className="rounded-[6px] border border-dashed border-[var(--line)] bg-white p-6 text-center text-sm text-[var(--muted)]">
              暂无最近调用 receipt。
            </div>
          ) : (
            <div className="grid gap-3">
              {recentReceipts.map((r) => (
                <div key={r.callId} className="rounded-[6px] border border-[var(--line)] bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="mono text-sm font-semibold">Receipt {r.receipt}</div>
                    <div className="mono text-sm">{r.amount}</div>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs">
                    <div className="grid grid-cols-[80px_1fr] gap-2">
                      <dt className="text-[var(--muted)]">callId</dt>
                      <dd className="mono truncate">{r.callId}</dd>
                    </div>
                    <div className="grid grid-cols-[80px_1fr] gap-2">
                      <dt className="text-[var(--muted)]">inputHash</dt>
                      <dd className="mono truncate">{r.inputHash}</dd>
                    </div>
                    <div className="grid grid-cols-[80px_1fr] gap-2">
                      <dt className="text-[var(--muted)]">tx</dt>
                      <dd className="mono truncate">{r.tx}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
