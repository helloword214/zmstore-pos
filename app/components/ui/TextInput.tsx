import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";
import { useId } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  id?: string;
}

export function TextInput({ label, error, id, className, ...props }: Props) {
  const autoId = useId();
  const inputId = id || autoId;

  // Only apply to type="number"
  const isNumberInput = props.type === "number";

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          {label}
        </label>
      )}

      <input
        id={inputId}
        {...props}
        className={clsx(
          "h-9 w-full rounded-xl border bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors duration-150",
          "placeholder:text-slate-400",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          error ? "border-rose-300 bg-rose-50" : "border-slate-300",
          className
        )}
        min={isNumberInput ? 0 : undefined}
        onKeyDown={(e) => {
          if (
            isNumberInput &&
            e.key === "ArrowDown" &&
            Number((e.target as HTMLInputElement).value) <= 0
          ) {
            e.preventDefault(); // prevent step-down at 0
          }
          props.onKeyDown?.(e); // allow custom handler
        }}
        onInput={(e) => {
          const input = e.currentTarget;
          if (isNumberInput && parseFloat(input.value) < 0) {
            input.value = "0"; // sanitize
          }
          props.onInput?.(e); // allow custom handler
        }}
        onWheel={(e) => {
          if (isNumberInput) e.currentTarget.blur(); // prevent scroll change
        }}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
      />

      {error && (
        <p id={`${inputId}-error`} className="text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
