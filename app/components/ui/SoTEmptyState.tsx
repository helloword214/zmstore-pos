import type { ReactNode } from "react";

type SoTEmptyStateProps = {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function SoTEmptyState({
  title,
  hint,
  action,
  className = "",
}: SoTEmptyStateProps) {
  return (
    <div className={`px-4 py-6 text-center ${className}`.trim()}>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
