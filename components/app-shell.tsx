import Link from "next/link";
import { Network } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { navItems } from "@/lib/mock-data";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[rgba(245,247,244,0.88)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-[6px] border border-[var(--graphite)] bg-[var(--graphite)] text-[var(--green)]">
              <Network size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold">AgentPay Passport</div>
              <div className="mono text-[11px] text-[var(--muted)]">Monad Testnet · MON</div>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-[6px] px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-white hover:text-[var(--foreground)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <ConnectButton
            accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
            chainStatus={{ smallScreen: "icon", largeScreen: "icon" }}
            showBalance={false}
          />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-[var(--line)] pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        <div className="mono mb-2 text-xs font-semibold uppercase text-[var(--green-dark)]">{eyebrow}</div>
        <h1 className="text-3xl font-semibold leading-tight text-[var(--foreground)] md:text-5xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">{description}</p>
      </div>
      {action}
    </div>
  );
}
