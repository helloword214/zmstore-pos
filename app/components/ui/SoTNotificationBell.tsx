import { Link } from "@remix-run/react";

type ReminderItem = {
  id: string;
  label: string;
  count: number;
  to: string;
};

type SoTNotificationBellProps = {
  items: ReminderItem[];
};

function toneClass(count: number) {
  if (count <= 0) return "border-slate-200 bg-white text-slate-500";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export function SoTNotificationBell({ items }: SoTNotificationBellProps) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.count || 0)), 0);
  const hasNotifications = total > 0;

  return (
    <details className="relative">
      <summary
        className={[
          "flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl border",
          "text-sm font-semibold shadow-sm transition-colors duration-150 hover:bg-slate-50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 active:translate-y-[0.5px]",
          hasNotifications ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-700",
        ].join(" ")}
        title="Notifications"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
          <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
        </svg>
        {hasNotifications ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </summary>

      <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Reminders</div>
          <div className="text-xs text-slate-500">
            {hasNotifications ? `${total} pending item(s)` : "No pending reminders"}
          </div>
        </div>

        <div className="max-h-72 overflow-auto p-2">
          {items.map((item) => (
            <Link
              key={item.id}
              to={item.to}
              className="mb-2 block rounded-xl border border-slate-200 px-3 py-2 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">{item.label}</span>
                <span
                  className={[
                    "inline-flex min-w-[22px] items-center justify-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold",
                    toneClass(item.count),
                  ].join(" ")}
                >
                  {item.count}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </details>
  );
}
