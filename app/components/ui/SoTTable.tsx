import type { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

type SoTTableProps = TableHTMLAttributes<HTMLTableElement> & {
  children: ReactNode;
  compact?: boolean;
  containerClassName?: string;
};

type SoTCellProps = (ThHTMLAttributes<HTMLTableCellElement> | TdHTMLAttributes<HTMLTableCellElement>) & {
  align?: "left" | "right" | "center";
};

function alignClass(align?: "left" | "right" | "center") {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

export function SoTTable({
  children,
  compact = false,
  className = "",
  containerClassName = "",
  ...props
}: SoTTableProps) {
  const sizeClass = compact ? "text-xs" : "text-sm";

  return (
    <div className={`w-full overflow-x-auto ${containerClassName}`.trim()}>
      <table className={`w-full ${sizeClass} ${className}`.trim()} {...props}>
        {children}
      </table>
    </div>
  );
}

export function SoTTableHead({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={`bg-slate-50 text-slate-600 ${className}`.trim()} {...props}>
      {children}
    </thead>
  );
}

export function SoTTableRow({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`border-t border-slate-100 align-top ${className}`.trim()} {...props}>
      {children}
    </tr>
  );
}

export function SoTTh({ align = "left", className = "", ...props }: SoTCellProps) {
  return (
    <th
      className={`px-3 py-2 font-medium ${alignClass(align)} ${className}`.trim()}
      {...(props as ThHTMLAttributes<HTMLTableCellElement>)}
    />
  );
}

export function SoTTd({ align = "left", className = "", ...props }: SoTCellProps) {
  return (
    <td
      className={`px-3 py-2 ${alignClass(align)} ${className}`.trim()}
      {...(props as TdHTMLAttributes<HTMLTableCellElement>)}
    />
  );
}

export function SoTTableEmptyRow({
  colSpan,
  message,
  className = "",
}: {
  colSpan: number;
  message: ReactNode;
  className?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className={`px-3 py-6 text-center text-slate-500 ${className}`.trim()}>
        {message}
      </td>
    </tr>
  );
}
