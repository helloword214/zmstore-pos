import type { ButtonHTMLAttributes, ReactNode } from "react";

type SoTButtonVariant = "primary" | "secondary" | "danger";

type SoTButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: SoTButtonVariant;
};

function variantClass(variant: SoTButtonVariant) {
  if (variant === "primary") {
    return "bg-indigo-600 text-white hover:bg-indigo-700";
  }
  if (variant === "danger") {
    return "bg-rose-600 text-white hover:bg-rose-700";
  }
  return "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
}

export function SoTButton({
  children,
  variant = "secondary",
  className = "",
  ...props
}: SoTButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 disabled:opacity-50";

  return (
    <button className={`${base} ${variantClass(variant)} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
