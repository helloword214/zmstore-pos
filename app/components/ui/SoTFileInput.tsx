import { clsx } from "clsx";
import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

type SoTFileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  error?: string;
};

export const SoTFileInput = forwardRef<HTMLInputElement, SoTFileInputProps>(
  function SoTFileInput({ className, error, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="file"
        {...props}
        className={clsx(
          "w-full text-xs text-slate-700",
          "file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700",
          "file:transition-colors file:duration-150 hover:file:bg-slate-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1",
          error ? "file:border-rose-300 text-rose-700" : null,
          className
        )}
        aria-invalid={Boolean(error)}
      />
    );
  }
);
