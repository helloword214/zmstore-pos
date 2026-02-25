import type { ReactNode } from "react";

type SoTCardTone = "default" | "success" | "danger";

type SoTCardProps = {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  tone?: SoTCardTone;
  compact?: boolean;
  className?: string;
};

function toneClass(tone: SoTCardTone) {
  if (tone === "success") return "border-emerald-200 bg-emerald-50";
  if (tone === "danger") return "border-rose-200 bg-rose-50";
  return "border-slate-200 bg-white";
}

export function SoTCard({
  title,
  meta,
  children,
  tone = "default",
  compact = false,
  className = "",
}: SoTCardProps) {
  const pad = compact ? "p-3" : "p-4";

  return (
    <section className={`rounded-2xl border shadow-sm ${toneClass(tone)} ${pad} ${className}`.trim()}>
      {title ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
          {meta}
        </div>
      ) : null}
      {children}
    </section>
  );
}
