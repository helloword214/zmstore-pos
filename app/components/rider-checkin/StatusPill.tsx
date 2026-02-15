// NEW FILE: app/components/rider-checkin/StatusPill.tsx
import * as React from "react";

export type StatusPillStatus =
  | "PENDING"
  | "REJECTED"
  | "VOIDED"
  | "NEEDS_CLEARANCE"
  | "FULLY_PAID"
  | "INFO";

type MiniPillTone = "slate" | "amber" | "indigo" | "rose" | "emerald";

function MiniPill({
  tone = "slate",
  children,
}: {
  tone?: MiniPillTone;
  children: React.ReactNode;
}) {
  const cls =
    tone === "indigo"
      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${cls}`}
    >
      {children}
    </span>
  );
}

function mapStatusToTone(status: StatusPillStatus): MiniPillTone {
  switch (status) {
    case "PENDING":
      return "indigo";
    case "REJECTED":
      return "rose";
    case "VOIDED":
      return "slate";
    case "NEEDS_CLEARANCE":
      return "amber";
    case "FULLY_PAID":
      return "emerald";
    case "INFO":
    default:
      return "slate";
  }
}

function defaultLabel(status: StatusPillStatus): string {
  switch (status) {
    case "PENDING":
      return "PENDING";
    case "REJECTED":
      return "REJECTED";
    case "VOIDED":
      return "VOIDED";
    case "NEEDS_CLEARANCE":
      return "Needs clearance";
    case "FULLY_PAID":
      return "Fully paid";
    case "INFO":
    default:
      return "Info";
  }
}

export function StatusPill({
  status,
  label,
}: {
  status: StatusPillStatus;
  label?: string;
}) {
  return (
    <MiniPill tone={mapStatusToTone(status)}>
      {label ?? defaultLabel(status)}
    </MiniPill>
  );
}
