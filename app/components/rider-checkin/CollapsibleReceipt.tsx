// UPDATED FILE (NEW FILE): app/components/rider-checkin/CollapsibleReceipt.tsx
import * as React from "react";

export function CollapsibleReceipt({
  title,
  subtitle,
  pill,
  open,
  onToggle,
  children,
  detailsLabelOpen = "Hide",
  detailsLabelClosed = "Details",
}: {
  title: string;
  subtitle?: React.ReactNode;
  pill?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  detailsLabelOpen?: string;
  detailsLabelClosed?: string;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-slate-900">
            {title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
            {subtitle}
            {pill}
          </div>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 text-[11px] text-slate-600 hover:text-slate-900"
        >
          {open ? detailsLabelOpen : detailsLabelClosed}
        </button>
      </div>

      {open && children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
