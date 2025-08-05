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
          className="block text-sm font-medium mb-1 text-gray-700"
        >
          {label}
        </label>
      )}
      <input
        type="text"
        name={name}
        placeholder={placeholder}
        className={`w-full p-2 border rounded text-gray-800 ${
          error
            ? "border-red-500 bg-red-50"
            : "border-gray-300 bg-white focus:border-blue-500 focus:outline-none"
        }`}
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
      />
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
}
