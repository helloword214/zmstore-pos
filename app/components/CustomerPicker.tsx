import * as React from "react";
import { useFetcher } from "@remix-run/react";
import { useCustomerSearch } from "~/hooks/useCustomerSearch";

type Customer = {
  id: number;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  alias?: string | null;
  phone?: string | null;
};

function displayName(c: Customer) {
  const mid = c.middleName ? ` ${c.middleName}` : "";
  const base = `${c.firstName}${mid} ${c.lastName}`.trim();
  const alias = c.alias ? ` (${c.alias})` : "";
  const phone = c.phone ? ` • ${c.phone}` : "";
  return `${base}${alias}${phone}`;
}

export function CustomerPicker({
  value,
  onChange,
  placeholder = "Search name / alias / phone…",
}: {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  placeholder?: string;
}) {
  const { q, setQ, items, loading, open, setOpen } = useCustomerSearch({
    withAddresses: false,
  });

  const createFx = useFetcher<any>();
  const detailsRef = React.useRef<HTMLDetailsElement | null>(null);

  // Inline “create customer” fields
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [middleName, setMiddleName] = React.useState("");
  const [alias, setAlias] = React.useState("");
  const [phone, setPhone] = React.useState("");

  // Use newly-created customer immediately
  React.useEffect(() => {
    if (createFx.data?.ok && createFx.data?.customer) {
      onChange(createFx.data.customer as Customer);
      setOpen(false);
      setQ("");
      setFirstName("");
      setLastName("");
      setMiddleName("");
      setAlias("");
      setPhone("");
      detailsRef.current?.removeAttribute("open");
    }
  }, [createFx.data, onChange, setOpen, setQ]);

  // Close dropdown when a value is chosen
  React.useEffect(() => {
    if (value) setOpen(false);
  }, [value, setOpen]);

  // Basic outside-click close (optional)
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node | null;
      if (rootRef.current && t && !rootRef.current.contains(t)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className="relative">
      <div className="flex gap-2">
        <input
          value={value ? displayName(value) : q}
          onChange={(e) => {
            // switching back to search mode clears the chosen value
            if (value) onChange(null);
            setQ(e.target.value);
          }}
          onFocus={() => q.trim() && setOpen(true)}
          onKeyDown={(e) => {
            // prevent enter from submitting parent form
            if (e.key === "Enter") e.preventDefault();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 text-sm"
            title="Clear customer"
          >
            ✕
          </button>
        )}
      </div>

      {open && !value && q.trim() && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-md">
          {items.length > 0 ? (
            <ul className="max-h-64 overflow-auto py-1">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                      setQ("");
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                  >
                    <div className="font-medium text-slate-900">
                      {c.firstName}
                      {c.middleName ? ` ${c.middleName}` : ""} {c.lastName}
                      {c.alias ? ` (${c.alias})` : ""}
                    </div>
                    <div className="text-xs text-slate-500">
                      {c.phone || "—"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : loading ? (
            <div className="px-3 py-2 text-sm text-slate-600">Searching…</div>
          ) : (
            <div className="px-3 py-2 text-sm text-slate-600">No results.</div>
          )}

          <div className="border-t border-slate-100 p-2">
            <details
              ref={detailsRef}
              onToggle={(e) => {
                const opened = (e.target as HTMLDetailsElement).open;
                if (opened && !firstName) setFirstName(q);
              }}
            >
              <summary className="text-sm cursor-pointer">
                ➕ Add new customer
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                    className="rounded-lg border px-2 py-1.5 text-sm"
                  />
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                    className="rounded-lg border px-2 py-1.5 text-sm"
                  />
                </div>
                <input
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                  placeholder="Middle name (optional)"
                  className="rounded-lg border px-2 py-1.5 text-sm"
                />
                <input
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="Alias (optional)"
                  className="rounded-lg border px-2 py-1.5 text-sm"
                />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone (optional, unique)"
                  className="rounded-lg border px-2 py-1.5 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-indigo-600 text-white text-sm px-3 py-1.5"
                    onClick={() => {
                      const data = new FormData();
                      if (firstName) data.append("firstName", firstName);
                      if (lastName) data.append("lastName", lastName);
                      if (middleName) data.append("middleName", middleName);
                      if (alias) data.append("alias", alias);
                      if (phone) data.append("phone", phone);
                      createFx.submit(data, {
                        method: "post",
                        action: "/api/customers/create",
                      });
                    }}
                  >
                    Create
                  </button>
                  {createFx.data?.ok && createFx.data?.customer ? (
                    <button
                      type="button"
                      className="rounded-lg border px-3 py-1.5 text-sm"
                      onClick={() => {
                        const c = createFx.data.customer as Customer;
                        onChange(c);
                        setOpen(false);
                        setQ("");
                        setFirstName("");
                        setLastName("");
                        setMiddleName("");
                        setAlias("");
                        setPhone("");
                        detailsRef.current?.removeAttribute("open");
                      }}
                    >
                      Use “{displayName(createFx.data.customer as Customer)}”
                    </button>
                  ) : null}
                </div>
              </div>
              {createFx.data?.error && (
                <div className="mt-2 text-xs text-red-700">
                  {createFx.data.error}
                </div>
              )}
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
