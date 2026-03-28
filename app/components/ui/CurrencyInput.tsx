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

  const normalizeCurrencyDraft = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const firstDotIndex = cleaned.indexOf(".");

    if (firstDotIndex < 0) return cleaned;

    return [
      cleaned.slice(0, firstDotIndex + 1),
      cleaned.slice(firstDotIndex + 1).replace(/\./g, ""),
    ].join("");
  };

  const formatValue = (val: string) => {
    const num = parseFloat(val.replace(/,/g, ""));
    if (isNaN(num)) return "";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = normalizeCurrencyDraft(e.target.value);
    e.target.value = cleaned;
    onChange(e);
  };

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={name}
          className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          {label}
        </label>
      )}

      <input
        id={name}
        type="text"
        name={name}
        placeholder={placeholder}
        className={[
          "h-9 w-full rounded-xl border bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors duration-150",
          "placeholder:text-slate-400",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          error ? "border-rose-300 bg-rose-50" : "border-slate-300",
        ].join(" ")}
        value={
          isFocused
            ? value // raw while typing
            : value
            ? `₱${formatValue(value)}`
            : ""
        }
        onFocus={(e) => {
          setIsFocused(true);
          requestAnimationFrame(() => {
            e.currentTarget.select();
          });
        }}
        onBlur={() => setIsFocused(false)}
        onChange={handleChange}
        inputMode="decimal"
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
      />

      {error && (
        <p id={`${name}-error`} className="text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
