import type { ReactNode } from "react";

type SoTDataRowProps = {
  label: ReactNode;
  value: ReactNode;
  className?: string;
};

export function SoTDataRow({ label, value, className = "" }: SoTDataRowProps) {
  return (
    <div
      className={`flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs ${className}`.trim()}
    >
      <span className="text-slate-700">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}
