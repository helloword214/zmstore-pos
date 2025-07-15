import type { ReactNode } from "react";
import { clsx } from "clsx";

interface Props {
  children: ReactNode;
  columns?: number; // number of columns (default = 2)
  gap?: string; // tailwind gap class (default = gap-4)
  className?: string;
}

export function FormGroupRow({
  children,
  columns = 2,
  gap = "gap-4",
  className,
}: Props) {
  return (
    <div
      className={clsx(
        "grid",
        gap,
        {
          "md:grid-cols-2": columns === 2,
          "md:grid-cols-3": columns === 3,
          "md:grid-cols-4": columns === 4,
        },
        "grid-cols-1", // fallback for mobile
        className
      )}
    >
      {children}
    </div>
  );
}
