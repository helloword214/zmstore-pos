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
        "flex items-center gap-1 px-3 py-1 rounded text-sm cursor-pointer border",
        checked
          ? "bg-orange-500 text-white border-orange-600"
          : "bg-gray-100 text-gray-700"
      )}
    >
      <input type="checkbox" className="hidden" checked={checked} {...props} />
      {label}
    </label>
  );
}
