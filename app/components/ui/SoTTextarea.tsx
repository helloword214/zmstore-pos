import { clsx } from "clsx";
import type { TextareaHTMLAttributes } from "react";
import { useId } from "react";

type SoTTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string;
};

export function SoTTextarea({
  label,
  error,
  id,
  className,
  ...props
}: SoTTextareaProps) {
  const autoId = useId();
  const textareaId = id || autoId;

  return (
    <div className="space-y-1">
      {label ? (
        <label
          htmlFor={textareaId}
          className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          {label}
        </label>
      ) : null}

      <textarea
        id={textareaId}
        {...props}
        className={clsx(
          "w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors duration-150",
          "placeholder:text-slate-400 resize-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          error ? "border-rose-300 bg-rose-50" : "border-slate-300",
          className
        )}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${textareaId}-error` : undefined}
      />

      {error ? (
        <p id={`${textareaId}-error`} className="text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
