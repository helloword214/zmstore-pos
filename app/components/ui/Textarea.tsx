import { clsx } from "clsx";
import type { TextareaHTMLAttributes } from "react";

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className, ...props }: Props) {
  return (
    <div className="mb-4">
      {label && (
        <label className="block text-sm font-medium mb-1">{label}</label>
      )}
      <textarea
        className={clsx(
          "w-full p-2 border rounded shadow-sm transition resize-none",
          error
            ? "border-red-500 bg-red-50"
            : "border-gray-300 focus:border-blue-500",
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
}
