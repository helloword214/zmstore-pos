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
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-300 opacity-80" />
      <span className="relative inline-flex h-full w-full rounded-full bg-indigo-500" />
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
        className="pointer-events-none fixed inset-0 z-[100]"
        {...props}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-slate-200/40">
          <div className="h-full w-2/5 rounded-r-full bg-gradient-to-r from-indigo-300 via-indigo-500 to-indigo-600 animate-pulse" />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(224,231,255,0.54),_rgba(255,255,255,0.82)_38%,_rgba(248,250,252,0.94)_100%)] backdrop-blur-[1.5px]" />
        <div className="relative flex min-h-full items-center justify-center px-5 py-8">
          <div
            className={`w-full max-w-md rounded-[24px] border border-slate-200/95 bg-white/94 px-5 py-5 shadow-xl shadow-slate-200/70 ring-1 ring-slate-900/5 print:hidden ${className}`.trim()}
          >
            <div className="flex items-start gap-3">
              <LoadingPulse />
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-900">{label}</p>
                {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
              </div>
            </div>
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
        className={`inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/85 px-3 py-1.5 text-xs font-medium text-indigo-700 ${className}`.trim()}
        {...props}
      >
        <LoadingPulse compact />
        <span>{label}</span>
        {hint ? <span className="text-indigo-500">{hint}</span> : null}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`flex items-start gap-3 rounded-2xl border border-indigo-100 bg-white/95 px-4 py-4 shadow-sm shadow-indigo-100/40 ring-1 ring-slate-900/5 ${className}`.trim()}
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
