import type { HTMLAttributes, ReactNode } from "react";

type SoTCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  interaction?: "static" | "link" | "form";
  interactive?: boolean;
  compact?: boolean;
};

export function sotCardClass({
  interaction = "static",
  interactive = false,
  compact = false,
  className = "",
}: {
  interaction?: "static" | "link" | "form";
  interactive?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const mode = interactive ? "link" : interaction;

  return [
    "rounded-2xl border border-slate-200 bg-white shadow-sm",
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
  className = "",
  ...props
}: SoTCardProps) {
  return (
    <div
      className={sotCardClass({ interaction, interactive, compact, className })}
      {...props}
    >
      {children}
    </div>
  );
}
