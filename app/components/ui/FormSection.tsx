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
        bordered ? "border border-gray-200 rounded p-4" : "",
        className
      )}
    >
      <header className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        {description && (
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}
