import type { ReactNode } from "react";

type SoTStatusPillTone = "info" | "success" | "warning" | "danger";

type SoTStatusPillProps = {
  children: ReactNode;
  tone?: SoTStatusPillTone;
};

function toneClass(tone: SoTStatusPillTone) {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "danger") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function SoTStatusPill({ children, tone = "info" }: SoTStatusPillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClass(
        tone,
      )}`}
    >
      {children}
    </span>
  );
}
