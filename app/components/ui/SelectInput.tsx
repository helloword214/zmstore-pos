import { clsx } from "clsx";
import type { SelectHTMLAttributes } from "react";

interface Option {
  value: string | number;
  label: string;
}

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Option[];
  error?: string;
}

export function SelectInput({
  label,
  options,
  error,
  className,
  ...props
}: Props) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-sm font-medium mb-1">{label}</label>
      )}
      <select
        className={clsx(
          "w-full p-2 border rounded shadow-sm transition",
          error
            ? "border-red-500 bg-red-50 text-gray-800"
            : "border-gray-300 focus:border-blue-500",
          className
        )}
        {...props}
      >
        {!options.some((opt) => opt.value === "") && (
          <option value="">-- Select --</option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
}
