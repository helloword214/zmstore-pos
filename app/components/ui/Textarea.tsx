import { clsx } from "clsx";
import type { TextareaHTMLAttributes } from "react";

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className, ...props }: Props) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-sm font-medium mb-1 text-slate-700">
          {label}
        </label>
      )}

      <textarea
        className={clsx(
          // base
          "w-full rounded-xl border bg-white px-3 py-2.5 text-slate-900 shadow-sm transition",
          "placeholder:text-slate-400 resize-none", // keep no-resize behavior
          // focus/hover
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:border-indigo-300 hover:bg-slate-50/50",
          // error state
          error ? "border-rose-300 bg-rose-50" : "border-slate-300",
          className
        )}
        {...props}
        aria-invalid={!!error}
      />

      {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
