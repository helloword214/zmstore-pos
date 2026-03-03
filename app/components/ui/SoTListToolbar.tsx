import { Form } from "@remix-run/react";
import type { ReactNode } from "react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTLinkButton } from "~/components/ui/SoTLinkButton";
import { SoTSearchInput } from "~/components/ui/SoTSearchInput";
import { SelectInput } from "~/components/ui/SelectInput";

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
            <SoTSearchInput
              name="q"
              defaultValue={query}
              placeholder={searchPlaceholder}
              className="w-56"
            />
          </SoTFormField>

          <SoTFormField label={statusLabel}>
            <SelectInput
              name="status"
              defaultValue={status}
              className="w-36"
              options={statusOptions.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
            />
          </SoTFormField>

          {extraFilters}

          <SoTButton type="submit" variant="secondary">
            Apply
          </SoTButton>

          <SoTLinkButton
            to={resetTo}
            variant="secondary"
          >
            Reset
          </SoTLinkButton>
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
