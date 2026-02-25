import type { ReactNode } from "react";

type SoTSectionHeaderProps = {
  title: string;
  subtitle?: ReactNode;
};

export function SoTSectionHeader({ title, subtitle }: SoTSectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {subtitle ? <span className="text-xs text-slate-500">{subtitle}</span> : null}
    </div>
  );
}
