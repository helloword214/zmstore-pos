import type { ReactNode } from "react";

type SoTFormFieldProps = {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
};

export function SoTFormField({
  label,
  children,
  hint,
  error,
  className = "",
}: SoTFormFieldProps) {
  return (
    <div className={`space-y-1 ${className}`.trim()}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </div>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
