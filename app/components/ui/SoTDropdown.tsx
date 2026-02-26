import type { ReactNode, SelectHTMLAttributes } from "react";

type SoTDropdownProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  children: ReactNode;
  hint?: string;
};

export function SoTDropdown({
  label,
  children,
  hint,
  className = "",
  id,
  ...props
}: SoTDropdownProps) {
  const selectId = id || props.name;

  return (
    <div className="space-y-1">
      {label ? (
        <label
          htmlFor={selectId}
          className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        className={
          "h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 " +
          "outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 " +
          className
        }
        {...props}
      >
        {children}
      </select>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
