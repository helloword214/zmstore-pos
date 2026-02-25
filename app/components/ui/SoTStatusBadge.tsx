import type { ReactNode } from "react";

type SoTStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

type SoTStatusBadgeProps = {
  children: ReactNode;
  tone?: SoTStatusTone;
  className?: string;
};

function toneClass(tone: SoTStatusTone) {
  if (tone === "info") return "border-indigo-200 bg-indigo-50 text-indigo-800";
  if (tone === "success")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "danger") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function SoTStatusBadge({
  children,
  tone = "neutral",
  className = "",
}: SoTStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass(tone)} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
