"use client";

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

// Form-grade Field controls used by the End User flow pages. The read-only
// Field primitive in components/ui.tsx renders a defaultValue input and is
// designed for static display — these components accept refs (so they integrate
// with react-hook-form's `register()`) and surface a validation message slot.

type CommonProps = {
  label: string;
  hint?: string;
  error?: string | null;
};

type TextFieldProps = CommonProps & InputHTMLAttributes<HTMLInputElement>;
type TextAreaProps = CommonProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, hint, error, className, ...rest }, ref) {
    return (
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-[var(--muted)]">
          {label}
        </span>
        <input
          ref={ref}
          className={`w-full rounded-[6px] border ${error ? "border-red-500" : "border-[var(--line)]"} bg-white px-3 py-2 text-sm outline-none focus:border-[var(--graphite)] ${className ?? ""}`}
          {...rest}
        />
        {error ? (
          <span className="mt-1 block text-xs text-red-600" role="alert">
            {error}
          </span>
        ) : hint ? (
          <span className="mt-1 block text-xs text-[var(--muted-2)]">{hint}</span>
        ) : null}
      </label>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ label, hint, error, className, rows = 4, ...rest }, ref) {
    return (
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-[var(--muted)]">
          {label}
        </span>
        <textarea
          ref={ref}
          rows={rows}
          className={`w-full resize-none rounded-[6px] border ${error ? "border-red-500" : "border-[var(--line)]"} bg-white px-3 py-2 text-sm outline-none focus:border-[var(--graphite)] ${className ?? ""}`}
          {...rest}
        />
        {error ? (
          <span className="mt-1 block text-xs text-red-600" role="alert">
            {error}
          </span>
        ) : hint ? (
          <span className="mt-1 block text-xs text-[var(--muted-2)]">{hint}</span>
        ) : null}
      </label>
    );
  },
);

export function SubmitButton({
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-[6px] bg-[var(--graphite)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
      {...rest}
    >
      {children}
    </button>
  );
}
