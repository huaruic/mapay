import type { LucideIcon } from "lucide-react";

export function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="panel-flat p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-[var(--muted)]">{label}</span>
        <Icon size={18} className="text-[var(--green-dark)]" />
      </div>
      <div className="mono text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function SectionTitle({ label, title }: { label: string; title: string }) {
  return (
    <div className="mb-4">
      <div className="mono text-xs font-semibold uppercase text-[var(--muted-2)]">{label}</div>
      <h2 className="mt-1 text-xl font-semibold">{title}</h2>
    </div>
  );
}

export function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center justify-center rounded-[6px] bg-[var(--graphite)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black">
      {children}
    </button>
  );
}

export function SecondaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center justify-center rounded-[6px] border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--graphite)]">
      {children}
    </button>
  );
}

export function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-[6px] border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--green-dark)]">
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function Field({
  label,
  value,
  multiline,
  name,
  required,
  placeholder,
}: {
  label: string;
  value?: string;
  multiline?: boolean;
  name?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const baseClass =
    "w-full rounded-[6px] border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--graphite)]";
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[var(--muted)]">{label}</span>
      {multiline ? (
        <textarea
          name={name}
          defaultValue={value}
          required={required}
          placeholder={placeholder}
          rows={4}
          className={`${baseClass} resize-none`}
        />
      ) : (
        <input
          name={name}
          defaultValue={value}
          required={required}
          placeholder={placeholder}
          className={baseClass}
        />
      )}
    </label>
  );
}
