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
    <div className="mb-4">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium mb-1 text-gray-700"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        className={clsx(
          "w-full p-2 border rounded transition shadow-sm text-gray-800",
          error
            ? "border-red-500 bg-red-50"
            : "border-gray-300 bg-white focus:border-blue-500 focus:outline-none",
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
          if (isNumberInput) {
            e.currentTarget.blur(); // prevent scroll change
          }
        }}
      />
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
}
