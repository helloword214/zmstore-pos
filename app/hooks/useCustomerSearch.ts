import * as React from "react";

type CustomerLite = {
  id: number;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  alias?: string | null;
  phone?: string | null;
  addresses?: any[];
};

export function useCustomerSearch(params?: {
  withAddresses?: boolean;
  openOnly?: boolean;
  delay?: number;
}) {
  const delay = params?.delay ?? 250;
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<CustomerLite[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  const ctrlRef = React.useRef<AbortController | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const lastIssuedRef = React.useRef<string>("");

  React.useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (!q.trim()) {
      setItems([]); // clear instantly; prevents stale flicker
      setOpen(false);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      const url = new URL("/api/customers/search", window.location.origin);
      url.searchParams.set("q", q.trim());
      if (params?.withAddresses) url.searchParams.set("withAddresses", "1");
      if (params?.openOnly) url.searchParams.set("openOnly", "1");

      lastIssuedRef.current = q;
      setLoading(true);
      try {
        const res = await fetch(url.toString(), { signal: ctrl.signal });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = (await res.json()) as { items: CustomerLite[] };
        // Only apply if this response matches the latest query
        if (lastIssuedRef.current === q) {
          setItems(data.items);
          setOpen(true);
        }
      } catch (err) {
        if ((err as any)?.name !== "AbortError")
          console.warn("Search error:", err);
      } finally {
        if (lastIssuedRef.current === q) setLoading(false);
      }
    }, delay) as unknown as number;
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      ctrlRef.current?.abort();
    };
  }, [q, params?.withAddresses, params?.openOnly, delay]);

  return { q, setQ, items, loading, open, setOpen };
}
