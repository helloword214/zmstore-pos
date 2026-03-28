import type { HTMLAttributes, ReactNode } from "react";

type SoTLoadingStateVariant = "overlay" | "panel" | "inline";

type SoTLoadingStateProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  hint?: ReactNode;
  variant?: SoTLoadingStateVariant;
};

function LoadingPulse({ compact = false }: { compact?: boolean }) {
  const sizeClass = compact ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <span className={`relative flex ${sizeClass}`}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
      <span className="relative inline-flex h-full w-full rounded-full bg-sky-500" />
    </span>
  );
}

export function SoTLoadingState({
  label,
  hint,
  variant = "panel",
  className = "",
  ...props
}: SoTLoadingStateProps) {
  if (variant === "overlay") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`pointer-events-none fixed inset-0 z-[100] ${className}`.trim()}
        {...props}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-slate-200/80">
          <div className="h-full w-1/3 rounded-r-full bg-gradient-to-r from-amber-400 via-sky-500 to-indigo-500 animate-pulse" />
        </div>
        <div className="absolute inset-0 bg-white/35 backdrop-blur-[1px]" />
        <div className="absolute bottom-4 right-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg ring-1 ring-slate-900/5 print:hidden">
          <LoadingPulse />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-slate-900">{label}</p>
            {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 ${className}`.trim()}
        {...props}
      >
        <LoadingPulse compact />
        <span>{label}</span>
        {hint ? <span className="text-slate-500">{hint}</span> : null}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-4 shadow-sm ring-1 ring-slate-900/5 ${className}`.trim()}
      {...props}
    >
      <LoadingPulse />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}
