import type { ReactNode } from "react";
import { Link } from "@remix-run/react";

type SoTNonDashboardHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  backTo?: string;
  backLabel?: string;
  maxWidthClassName?: string;
};

export function SoTNonDashboardHeader({
  title,
  subtitle,
  backTo = "/store",
  backLabel = "Dashboard",
  maxWidthClassName = "max-w-6xl",
}: SoTNonDashboardHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className={`mx-auto ${maxWidthClassName} px-5 py-4`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link
            to={backTo}
            className="inline-flex items-center text-sm font-medium text-slate-700 transition-colors duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          >
            {"\u2190"} {backLabel}
          </Link>
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
    </header>
  );
}
