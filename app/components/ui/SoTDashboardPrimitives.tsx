import type { ReactNode } from "react";
import { Link } from "@remix-run/react";

import { SoTCard, sotCardClass } from "~/components/ui/SoTCard";
import { SoTSectionHeader } from "~/components/ui/SoTSectionHeader";

type SoTDashboardTone = "default" | "success" | "danger" | "info" | "warning";

const dashboardToneTextClass: Record<SoTDashboardTone, string> = {
  default: "text-slate-700",
  success: "text-emerald-800",
  danger: "text-rose-800",
  info: "text-sky-800",
  warning: "text-amber-800",
};

const dashboardBadgeClass: Record<SoTDashboardTone, string> = {
  default: "border-slate-200 bg-white text-slate-700",
  success: "border-emerald-200 bg-white text-emerald-800",
  danger: "border-rose-200 bg-white text-rose-800",
  info: "border-sky-200 bg-white text-sky-800",
  warning: "border-amber-200 bg-white text-amber-800",
};

const dashboardRowClass: Record<SoTDashboardTone, string> = {
  default: "border-slate-200 bg-white hover:bg-slate-50",
  success: "border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/60",
  danger: "border-rose-200 bg-rose-50/60 hover:bg-rose-100/60",
  info: "border-sky-200 bg-sky-50/60 hover:bg-sky-100/60",
  warning: "border-amber-200 bg-amber-50/60 hover:bg-amber-100/60",
};

type SoTDashboardSectionProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
};

type SoTDashboardPanelProps = {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  tone?: SoTDashboardTone;
  compact?: boolean;
};

type SoTDashboardQueueRowProps = {
  to: string;
  label: string;
  value?: ReactNode;
  actionLabel?: string;
  tone?: SoTDashboardTone;
};

type SoTDashboardActionTileProps = {
  to: string;
  title: string;
  detail?: ReactNode;
  actionLabel?: string;
  eyebrow?: ReactNode;
  badge?: ReactNode;
  tone?: SoTDashboardTone;
  className?: string;
};

type SoTDashboardSignalProps = {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: SoTDashboardTone;
};

export function SoTDashboardTopGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`grid gap-4 xl:grid-cols-12 xl:items-stretch ${className}`.trim()}>{children}</div>;
}

export function SoTDashboardSection({
  title,
  subtitle,
  children,
  className = "",
}: SoTDashboardSectionProps) {
  return (
    <section className={className}>
      <SoTSectionHeader title={title} subtitle={subtitle} />
      {children}
    </section>
  );
}

export function SoTDashboardPanel({
  title,
  subtitle,
  eyebrow,
  badge,
  children,
  className = "",
  contentClassName = "",
  tone = "default",
  compact = false,
}: SoTDashboardPanelProps) {
  return (
    <SoTCard tone={tone} compact={compact} className={`h-full ${className}`.trim()}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <div className={`text-[11px] font-semibold uppercase tracking-wide ${dashboardToneTextClass[tone]}`}>
              {eyebrow}
            </div>
          ) : null}
          <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {badge ? (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${dashboardBadgeClass[tone]}`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className={`mt-4 ${contentClassName}`.trim()}>{children}</div>
    </SoTCard>
  );
}

export function SoTDashboardQueueList({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

export function SoTDashboardQueueRow({
  to,
  label,
  value,
  actionLabel = "Open",
  tone = "default",
}: SoTDashboardQueueRowProps) {
  return (
    <Link
      to={to}
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 ${dashboardRowClass[tone]}`.trim()}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        {value ? <div className="mt-1 text-xs text-slate-500">{value}</div> : null}
      </div>
      <span className={`shrink-0 text-xs font-semibold ${dashboardToneTextClass[tone]}`}>
        {actionLabel}
      </span>
    </Link>
  );
}

export function SoTDashboardSignalGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`grid gap-3 sm:grid-cols-2 ${className}`.trim()}>{children}</div>;
}

export function SoTDashboardSignal({
  label,
  value,
  meta,
  tone = "default",
}: SoTDashboardSignalProps) {
  return (
    <SoTCard compact tone={tone} className="h-full">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      {meta ? <div className="mt-1 text-xs text-slate-500">{meta}</div> : null}
    </SoTCard>
  );
}

export function SoTDashboardActionGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-4 ${className}`.trim()}>{children}</div>;
}

export function SoTDashboardActionTile({
  to,
  title,
  detail,
  actionLabel = "Open",
  eyebrow,
  badge,
  tone = "default",
  className = "",
}: SoTDashboardActionTileProps) {
  return (
    <Link
      to={to}
      className={sotCardClass({
        interaction: "link",
        tone,
        className: `flex h-full flex-col justify-between gap-3 ${className}`.trim(),
      })}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <div className={`text-[11px] font-semibold uppercase tracking-wide ${dashboardToneTextClass[tone]}`}>
              {eyebrow}
            </div>
          ) : null}
          <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
          {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
        </div>
        {badge ? (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${dashboardBadgeClass[tone]}`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className={`text-sm font-semibold ${dashboardToneTextClass[tone]}`}>{actionLabel}</div>
    </Link>
  );
}
