import type { InputHTMLAttributes } from "react";
import { clsx } from "clsx";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  checked: boolean;
}

export function TagCheckbox({ label, checked, ...props }: Props) {
  return (
    <label
      className={clsx(
        "inline-flex h-8 items-center rounded-xl border px-3 text-xs font-medium transition-colors duration-150",
        "cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-200 focus-within:ring-offset-1",
        checked
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      )}
    >
      <input type="checkbox" className="sr-only" checked={checked} {...props} />
      {label}
    </label>
  );
}
