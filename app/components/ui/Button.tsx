// app/components/ui/Button.tsx
import { clsx } from "clsx";
import { theme } from "~/lib/theme";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "accent" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

export function Button({
  variant = "accent",
  children,
  className,
  ...props
}: ButtonProps) {
  // Base: compact, readable, with proper focus/disabled handling
  const base =
    "inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-sm font-medium " +
    "transition shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:ring-offset-1 " +
    "disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-[1px]";

  // Elegant light-theme variants (used if theme.buttons[variant] is missing)
  const fallbackByVariant: Record<Variant, string> = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    accent: "bg-slate-900 text-white hover:bg-slate-800",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    ghost: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
  };

  // Prefer theme if provided; otherwise use fallbacks
  const themed = (theme as any)?.buttons?.[variant] as string | undefined;
  const variantClasses = themed ?? fallbackByVariant[variant];

  return (
    <button className={clsx(base, variantClasses, className)} {...props}>
      {children}
    </button>
  );
}
