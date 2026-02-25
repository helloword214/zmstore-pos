import type { ReactNode } from "react";

type SoTActionBarProps = {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
};

export function SoTActionBar({ left, right, className = "" }: SoTActionBarProps) {
  return (
    <div
      className={`mb-3 flex flex-wrap items-center justify-between gap-2 ${className}`.trim()}
    >
      <div className="min-h-[1px]">{left}</div>
      <div className="flex flex-wrap items-center gap-2">{right}</div>
    </div>
  );
}
