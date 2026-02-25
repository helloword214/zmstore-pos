import type { HTMLAttributes, ReactNode } from "react";

type SoTAlertTone = "info" | "success" | "warning" | "danger";

type SoTAlertProps = HTMLAttributes<HTMLDivElement> & {
  tone?: SoTAlertTone;
  title?: string;
  children: ReactNode;
};

function toneClass(tone: SoTAlertTone) {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  if (tone === "danger") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }
  return "border-sky-200 bg-sky-50 text-sky-900";
}

export function SoTAlert({
  tone = "info",
  title,
  children,
  className = "",
  ...props
}: SoTAlertProps) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-xs ${toneClass(tone)} ${className}`.trim()}
      {...props}
    >
      {title ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
