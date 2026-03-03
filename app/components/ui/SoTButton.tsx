import type { ButtonHTMLAttributes, ReactNode } from "react";

type SoTButtonVariant = "primary" | "secondary" | "danger";
type SoTButtonSize = "default" | "compact";

type SoTButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: SoTButtonVariant;
  size?: SoTButtonSize;
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

function sizeClass(size: SoTButtonSize) {
  if (size === "compact") {
    return "h-9 px-3 text-xs";
  }
  return "h-9 px-3 text-sm";
}

export function SoTButton({
  children,
  variant = "secondary",
  size = "default",
  className = "",
  ...props
}: SoTButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-xl font-medium transition-colors duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-50";

  return (
    <button
      className={`${base} ${sizeClass(size)} ${variantClass(variant)} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
