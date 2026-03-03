import { clsx } from "clsx";
import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

type SoTSearchInputProps = InputHTMLAttributes<HTMLInputElement>;

export const SoTSearchInput = forwardRef<HTMLInputElement, SoTSearchInputProps>(
  function SoTSearchInput({ className, type = "search", ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        {...props}
        className={clsx(
          "h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors duration-150",
          "placeholder:text-slate-400",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          className
        )}
      />
    );
  }
);
