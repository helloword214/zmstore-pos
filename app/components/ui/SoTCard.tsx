import type { HTMLAttributes, ReactNode } from "react";

type SoTCardTone = "default" | "success" | "danger" | "info" | "warning";

type SoTCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  interaction?: "static" | "link" | "form";
  interactive?: boolean;
  compact?: boolean;
  tone?: SoTCardTone;
};

export function sotCardClass({
  interaction = "static",
  interactive = false,
  compact = false,
  tone = "default",
  className = "",
}: {
  interaction?: "static" | "link" | "form";
  interactive?: boolean;
  compact?: boolean;
  tone?: SoTCardTone;
  className?: string;
}) {
  const mode = interactive ? "link" : interaction;
  const toneClass: Record<SoTCardTone, string> = {
    default: "border-slate-200 bg-white",
    success: "border-emerald-200 bg-emerald-50/35",
    danger: "border-rose-200 bg-rose-50/35",
    info: "border-sky-200 bg-sky-50/35",
    warning: "border-amber-200 bg-amber-50/35",
  };

  return [
    "rounded-2xl border shadow-sm",
    toneClass[tone],
    compact ? "p-3" : "p-4",
    mode === "link"
      ? "cursor-pointer transition-colors duration-150 hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
      : "",
    mode === "form" ? "transition-colors duration-150" : "",
    className,
  ]
    .join(" ")
    .trim();
}

export function SoTCard({
  children,
  interaction = "static",
  interactive = false,
  compact = false,
  tone = "default",
  className = "",
  ...props
}: SoTCardProps) {
  return (
    <div
      className={sotCardClass({
        interaction,
        interactive,
        compact,
        tone,
        className,
      })}
      {...props}
    >
      {children}
    </div>
  );
}
