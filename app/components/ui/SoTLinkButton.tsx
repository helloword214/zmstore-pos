import { Link } from "@remix-run/react";
import type { LinkProps } from "@remix-run/react";
import type { ReactNode } from "react";

type SoTLinkButtonVariant = "primary" | "secondary" | "danger";
type SoTLinkButtonSize = "default" | "compact";

type SoTLinkButtonProps = Omit<LinkProps, "className"> & {
  children: ReactNode;
  variant?: SoTLinkButtonVariant;
  size?: SoTLinkButtonSize;
  className?: string;
};

function variantClass(variant: SoTLinkButtonVariant) {
  if (variant === "primary") {
    return "bg-indigo-600 text-white hover:bg-indigo-700";
  }
  if (variant === "danger") {
    return "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100";
  }
  return "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
}

function sizeClass(size: SoTLinkButtonSize) {
  if (size === "compact") {
    return "h-9 px-3 text-xs";
  }
  return "h-9 px-3 text-sm";
}

export function SoTLinkButton({
  children,
  variant = "secondary",
  size = "default",
  className = "",
  ...props
}: SoTLinkButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-xl font-medium shadow-sm transition-colors duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300";

  return (
    <Link
      className={`${base} ${sizeClass(size)} ${variantClass(variant)} ${className}`.trim()}
      {...props}
    >
      {children}
    </Link>
  );
}
