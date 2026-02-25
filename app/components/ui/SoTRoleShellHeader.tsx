import type { ReactNode } from "react";
import { Link } from "@remix-run/react";

type SoTRoleShellNavItem = {
  to: string;
  label: string;
  active?: boolean;
  badge?: number;
};

type SoTRoleShellHeaderProps = {
  title: string;
  identityLine?: ReactNode;
  navItems?: SoTRoleShellNavItem[];
  actions?: ReactNode;
  maxWidthClassName?: string;
  sticky?: boolean;
};

function ShellBadge({ count }: { count?: number }) {
  if (!count || count <= 0) return null;
  return (
    <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
      {count}
    </span>
  );
}

export function SoTRoleShellHeader({
  title,
  identityLine,
  navItems = [],
  actions,
  maxWidthClassName = "max-w-6xl",
  sticky = false,
}: SoTRoleShellHeaderProps) {
  return (
    <header
      className={[
        sticky ? "sticky top-0 z-20" : "",
        "border-b border-slate-200/70 bg-white/90 backdrop-blur",
      ]
        .join(" ")
        .trim()}
    >
      <div className={`mx-auto ${maxWidthClassName} px-5 py-4`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {identityLine ? <p className="text-xs text-slate-500">{identityLine}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>

        {navItems.length > 0 ? (
          <nav className="mt-3 flex flex-wrap items-center gap-2">
            {navItems.map((item) => (
              <Link
                key={`${item.to}:${item.label}`}
                to={item.to}
                className={[
                  "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium shadow-sm",
                  item.active
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                <span>{item.label}</span>
                <ShellBadge count={item.badge} />
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
