import { Form, Link } from "@remix-run/react";
import type { ReactNode } from "react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";

type StatusOption = {
  value: string;
  label: string;
};

type SoTListToolbarProps = {
  query: string;
  status: string;
  resetTo: string;
  addOpen: boolean;
  onToggleAdd: () => void;
  addLabel: string;
  hideAddLabel?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  statusLabel?: string;
  statusOptions?: StatusOption[];
  extraFilters?: ReactNode;
};

const DEFAULT_STATUS_OPTIONS: StatusOption[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function SoTListToolbar({
  query,
  status,
  resetTo,
  addOpen,
  onToggleAdd,
  addLabel,
  hideAddLabel = "Hide Add Form",
  searchLabel = "Search",
  searchPlaceholder = "Search",
  statusLabel = "Status",
  statusOptions = DEFAULT_STATUS_OPTIONS,
  extraFilters,
}: SoTListToolbarProps) {
  return (
    <SoTActionBar
      left={
        <Form method="get" className="flex flex-wrap items-end gap-2">
          <SoTFormField label={searchLabel}>
            <input
              name="q"
              defaultValue={query}
              placeholder={searchPlaceholder}
              className="h-9 w-56 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            />
          </SoTFormField>

          <SoTFormField label={statusLabel}>
            <select
              name="status"
              defaultValue={status}
              className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </SoTFormField>

          {extraFilters}

          <SoTButton type="submit" variant="secondary" className="h-9">
            Apply
          </SoTButton>

          <Link
            to={resetTo}
            className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          >
            Reset
          </Link>
        </Form>
      }
      right={
        <SoTButton type="button" variant="primary" onClick={onToggleAdd}>
          {addOpen ? hideAddLabel : addLabel}
        </SoTButton>
      }
    />
  );
}
