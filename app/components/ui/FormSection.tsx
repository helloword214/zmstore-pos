import type { ReactNode } from "react";
import { clsx } from "clsx";

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  bordered?: boolean;
}

export function FormSection({
  title,
  description,
  children,
  className,
  bordered = false,
}: Props) {
  return (
    <section
      className={clsx(
        "mb-6",
        bordered
          ? "rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm"
          : "",
        className
      )}
    >
      <header className="mb-3 sm:mb-4">
        <h3 className="text-lg font-semibold text-slate-900 tracking-tight">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </header>

      <div className="space-y-3 sm:space-y-4">{children}</div>
    </section>
  );
}
