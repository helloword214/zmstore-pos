import { useState } from "react";

interface Props {
  name: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  error?: string;
}

export function CurrencyInput({
  name,
  label,
  value,
  onChange,
  placeholder,
  error,
}: Props) {
  const [isFocused, setIsFocused] = useState(false);

  const formatValue = (val: string) => {
    const num = parseFloat(val.replace(/,/g, ""));
    if (isNaN(num)) return "";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/[^0-9.]/g, "");
    e.target.value = cleaned;
    onChange(e);
  };

  return (
    <div className="mb-4">
      {label && (
        <label
          htmlFor={name}
          className="block text-sm font-medium mb-1 text-slate-700"
        >
          {label}
        </label>
      )}

      <input
        type="text"
        name={name}
        placeholder={placeholder}
        className={[
          "w-full rounded-xl border bg-white px-3 py-2.5 text-slate-900 shadow-sm transition",
          "placeholder:text-slate-400",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:border-indigo-300",
          error
            ? "border-rose-300 bg-rose-50"
            : "border-slate-300 hover:bg-slate-50/50",
        ].join(" ")}
        value={
          isFocused
            ? value // raw while typing
            : value
            ? `₱${formatValue(value)}`
            : ""
        }
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={handleChange}
        inputMode="decimal"
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
      />

      {error && (
        <p id={`${name}-error`} className="mt-1 text-sm text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
