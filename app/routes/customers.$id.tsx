// app/routes/customers.$id.tsx
import { Outlet, NavLink, useParams } from "@remix-run/react";

export default function CustomerLayout() {
  const { id } = useParams();

  const tabBase =
    "rounded-xl px-3 py-2 text-sm transition shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200";
  const tabInactive =
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
  const tabActive = "bg-indigo-600 text-white border border-indigo-600";

  return (
    <div className="mx-auto p-0 md:p-6 print:p-0 text-slate-900 bg-[#f7f7fb] min-h-screen">
      {/* keep max width consistent with other pages */}
      <div className="mx-auto w-full max-w-4xl">
        {/* Sticky sub-nav only here (children should NOT add their own sticky headers) */}
        <div className="sticky top-0 z-10 -mx-2 md:mx-0 mb-4 border-b border-slate-200/70 bg-white/85 backdrop-blur">
          <div className="px-4 py-3 flex gap-2">
            <NavLink
              to={`/customers/${id}`}
              end
              className={({ isActive }) =>
                `${tabBase} ${isActive ? tabActive : tabInactive}`
              }
            >
              Profile
            </NavLink>
            <NavLink
              to={`/customers/${id}/pricing`}
              className={({ isActive }) =>
                `${tabBase} ${isActive ? tabActive : tabInactive}`
              }
            >
              Pricing Rules
            </NavLink>
            <NavLink
              to={`/ar/customers/${id}`}
              className={({ isActive }) =>
                `${tabBase} ${isActive ? tabActive : tabInactive}`
              }
            >
              AR / Ledger
            </NavLink>
          </div>
        </div>

        {/* Route content goes here; children should render simple sections, no full-screen <main> */}
        <div className="px-2 pb-4">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export const shouldRevalidate = () => false;
