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
        "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer border transition",
        "focus-within:ring-1 focus-within:ring-indigo-200",
        checked
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
      )}
    >
      <input type="checkbox" className="sr-only" checked={checked} {...props} />
      {label}
    </label>
  );
}
