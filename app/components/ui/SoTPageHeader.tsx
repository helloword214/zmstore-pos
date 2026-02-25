import type { ReactNode } from "react";

type SoTPageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  maxWidthClassName?: string;
  className?: string;
};

export function SoTPageHeader({
  title,
  subtitle,
  actions,
  maxWidthClassName = "max-w-6xl",
  className = "",
}: SoTPageHeaderProps) {
  return (
    <section className={className}>
      <div className={`mx-auto ${maxWidthClassName} flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between`}>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
          {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
