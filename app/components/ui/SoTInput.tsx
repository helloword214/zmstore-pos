import { useId } from "react";
import type { InputHTMLAttributes } from "react";

type SoTInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export function SoTInput({ label, error, id, className = "", ...props }: SoTInputProps) {
  const autoId = useId();
  const inputId = id || autoId;

  return (
    <div className="space-y-1">
      {label ? (
        <label htmlFor={inputId} className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        {...props}
        className={
          `w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ` +
          `placeholder:text-slate-400 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ` +
          `${error ? "border-rose-300 bg-rose-50" : "border-slate-300"} ${className}`
        }
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
