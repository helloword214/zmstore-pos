// app/components/ui/Button.tsx
import { clsx } from "clsx";
import { theme } from "~/lib/theme";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "danger"
  | "accent"
  | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  className?: string;
}

export function Button({
  variant = "secondary",
  size = "md",
  children,
  className,
  ...props
}: ButtonProps) {
  // Base: compact, readable, with proper focus/disabled handling.
  const base =
    "inline-flex items-center justify-center rounded-xl font-medium " +
    "transition-colors duration-150 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 " +
    "disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-[0.5px]";

  const sizeClasses: Record<Size, string> = {
    sm: "h-8 px-2.5 text-xs",
    md: "h-9 px-3 text-sm",
    lg: "h-10 px-4 text-sm",
  };

  // Variant hierarchy:
  // - primary: single dominant action per section
  // - secondary: standard safe action
  // - tertiary: low emphasis utility/nav
  // - danger: destructive action
  // Legacy aliases (accent/ghost) are kept for compatibility.
  const normalizedVariant: "primary" | "secondary" | "tertiary" | "danger" =
    variant === "accent"
      ? "secondary"
      : variant === "ghost"
        ? "tertiary"
        : variant;

  const fallbackByVariant: Record<Variant, string> = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-slate-700 text-white hover:bg-slate-800",
    tertiary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    accent: "bg-slate-700 text-white hover:bg-slate-800",
    ghost: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
  };

  // Prefer theme if provided; otherwise use fallbacks
  const themed = (theme as any)?.buttons?.[normalizedVariant] as
    | string
    | undefined;
  const variantClasses = themed ?? fallbackByVariant[normalizedVariant];

  return (
    <button
      className={clsx(base, sizeClasses[size], variantClasses, className)}
      {...props}
    >
      {children}
    </button>
  );
}
