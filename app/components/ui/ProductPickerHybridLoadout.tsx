import * as React from "react";
import { SelectInput } from "~/components/ui/SelectInput";
import { TextInput } from "~/components/ui/TextInput";

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type ProductRow = {
  id: number;
  name: string;
  brand?: { name: string | null } | null;
  category?: { name: string | null } | null; // optional, if your API returns it
  srp?: number | null; // optional, for pack-only checks if available
};

type Props = {
  /** optional; if you pass it, maglalagay ng hidden field for normal forms */
  name?: string;
  /** initial selection shown in the input */
  defaultValue?: ProductRow | null;
  /** notify parent (dispatch page) when a product is chosen */
  onSelect?: (p: ProductRow) => void;
  /** extra client-side filter (e.g., pack-only list) */
  filterRow?: (p: ProductRow) => boolean;
  placeholder?: string;
  disabled?: boolean;

  /** Optional: preload available categories for the BROWSE modal */
  categoryOptions?: string[];
};

export function ProductPickerHybridLoadout({
  name,
  defaultValue = null,
  onSelect,
  filterRow,
  placeholder = "Type ID or name…",
  disabled = false,
  categoryOptions,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<ProductRow[]>([]);
  const [openList, setOpenList] = React.useState(false);
  const [selected, setSelected] = React.useState<ProductRow | null>(
    defaultValue
  );
  const debounced = useDebounced(query, 200);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [inputFocused, setInputFocused] = React.useState(false);
  // Guards for network races / stale sets
  const reqIdRef = React.useRef(0);
  const inFlightRef = React.useRef<AbortController | null>(null);

  // Category filter state
  const [cat, setCat] = React.useState<string>("__ALL__");
  const applyCategory = React.useCallback(
    (rows: ProductRow[]) =>
      cat === "__ALL__"
        ? rows
        : rows.filter((p) => (p.category?.name ?? "") === cat),
    [cat]
  );

  // derive category options from fetched items when not provided
  const [seenCats, setSeenCats] = React.useState<Set<string>>(new Set());
  // Stable updater: uses functional setState so it doesn't depend on seenCats
  const addSeenCats = React.useCallback((rows: ProductRow[]) => {
    setSeenCats((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const r of rows) {
        const c = (r.category?.name ?? "").trim();
        if (c && !next.has(c)) {
          next.add(c);
          changed = true;
        }
      }
      return changed ? next : prev; // avoid useless state updates
    });
  }, []);

  // Keep an always-current ref for the (possibly inline) filterRow from parent
  const filterRowRef = React.useRef<typeof filterRow>();
  React.useEffect(() => {
    filterRowRef.current = filterRow;
  }, [filterRow]);

  // Combine custom filter (if any) + category filter into one stable fn
  const applyAllFilters = React.useCallback(
    (rows: ProductRow[]) => {
      const afterCustom = filterRowRef.current
        ? rows.filter(filterRowRef.current)
        : rows;
      return applyCategory(afterCustom);
    },
    [applyCategory]
  );

  // TYPEAHEAD fetch
  React.useEffect(() => {
    // Fetch only when the user actually typed something.
    const shouldFetch = debounced && debounced.length > 0;
    if (!shouldFetch) {
      // stop any running request and ensure UI is closed/reset
      reqIdRef.current++;
      inFlightRef.current?.abort();
      setResults([]);
      setOpenList(false); // keep it closed when there’s no query
      return;
    }
    const ctrl = new AbortController();
    inFlightRef.current?.abort(); // cancel previous
    inFlightRef.current = ctrl;
    const myReqId = ++reqIdRef.current;
    (async () => {
      const base = `/resources/products-search?q=${encodeURIComponent(
        debounced
      )}&pageSize=10`;
      const url =
        cat !== "__ALL__"
          ? `${base}&category=${encodeURIComponent(cat)}`
          : base;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return;
      const data = await res.json();
      const raw = ((data.items ?? []) as ProductRow[]) ?? [];
      // Drop stale responses
      if (myReqId !== reqIdRef.current) return;
      setResults(applyAllFilters(raw)); // apply filters
      if (inputFocused) setOpenList(true); // open only if user is interacting
    })().catch(() => {});
    return () => {
      if (inFlightRef.current === ctrl) inFlightRef.current = null;
      ctrl.abort();
    };
  }, [debounced, cat, inputFocused, applyAllFilters]);

  // outside click → close list
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // MODAL pagination/browse
  const [showModal, setShowModal] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pageData, setPageData] = React.useState<{
    items: ProductRow[];
    total: number;
    pageSize: number;
  }>({ items: [], total: 0, pageSize: 20 });
  const [modalQ, setModalQ] = React.useState("");
  const debouncedModalQ = useDebounced(modalQ, 250);

  React.useEffect(() => {
    if (!showModal) return;
    const ctrl = new AbortController();
    (async () => {
      const base = `/resources/products-search?q=${encodeURIComponent(
        debouncedModalQ
      )}&page=${page}&pageSize=${pageData.pageSize}`;
      const url =
        cat !== "__ALL__"
          ? `${base}&category=${encodeURIComponent(cat)}`
          : base;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return;
      const data = await res.json();
      const raw = ((data.items ?? []) as ProductRow[]) ?? [];
      addSeenCats(raw); // learn categories from full raw
      setPageData({
        items: applyAllFilters(raw),
        total: data.total,
        pageSize: data.pageSize,
      });
    })().catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, page, debouncedModalQ, cat, applyAllFilters, addSeenCats]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowModal(false);
    };
    if (showModal) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showModal]);

  const totalPages = Math.max(1, Math.ceil(pageData.total / pageData.pageSize));

  // merged category list (prop > discovered)
  const cats: string[] = React.useMemo(() => {
    const fromSeen = Array.from(seenCats.values()).sort((a, b) =>
      a.localeCompare(b)
    );
    const fromProp = (categoryOptions ?? []).slice();
    const all = new Set<string>([...fromProp, ...fromSeen].filter(Boolean));
    return Array.from(all.values()).sort((a, b) => a.localeCompare(b));
  }, [seenCats, categoryOptions]);

  // options for SelectInput
  const catOptions = React.useMemo(
    () => [
      { value: "__ALL__", label: "All categories" },
      ...cats.map((c) => ({ value: c, label: c })),
    ],
    [cats]
  );

  return (
    <div className="text-sm" ref={boxRef}>
      <div className="flex gap-2">
        {/* Search input */}
        <div className="min-w-0 flex-1 -mb-4">
          {name ? (
            <input type="hidden" name={name} value={selected?.id ?? ""} />
          ) : null}
          <TextInput
            className="h-11"
            placeholder={placeholder}
            value={selected ? `${selected.id} — ${selected.name}` : query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.currentTarget.value);
              setOpenList(true);
            }}
            onFocus={() => {
              setInputFocused(true);
              // Open only when there’s a non-empty query; otherwise keep it closed.
              if (!selected && debounced && debounced.length > 0)
                setOpenList(true);
            }}
            onBlur={() => {
              // don’t forcibly close here—outside click handler handles closing
              setInputFocused(false);
            }}
            disabled={disabled}
          />
        </div>

        <button
          type="button"
          className="shrink-0 h-11 rounded-xl border px-3 text-xs bg-white hover:bg-slate-50 disabled:opacity-50"
          onClick={() => {
            setShowModal(true);
            setPage(1);
            setModalQ("");
          }}
          disabled={disabled}
        >
          Browse…
        </button>
      </div>

      {/* TYPEAHEAD LIST — fixed height para hindi nagshi-shrink */}
      {openList && !selected && (
        <div className="mt-1 h-64 overflow-auto rounded-xl border bg-white shadow-lg">
          {results.length > 0 ? (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 hover:bg-slate-50"
                onClick={() => {
                  setSelected(p);
                  setOpenList(false);
                  onSelect?.(p);
                }}
                disabled={disabled}
              >
                <span className="font-mono text-xs text-slate-500">
                  #{p.id}
                </span>
                <span className="flex-1 text-left px-3">{p.name}</span>
                <span className="text-[11px] text-slate-500">
                  {(p.category?.name ?? "") || (p.brand?.name ?? "")}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-slate-500">No matches</div>
          )}
        </div>
      )}

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Dismiss modal"
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowModal(false)}
          />
          <div
            className="relative z-10 w-full max-w-3xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[80vh] overscroll-contain"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            {/* Sticky title + search/filter */}
            <div className="sticky top-0 z-20 bg-white">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="font-semibold">Browse Products</div>
                <button
                  className="text-slate-500 hover:text-slate-700"
                  onClick={() => setShowModal(false)}
                  disabled={disabled}
                >
                  ✕
                </button>
              </div>
              <div className="px-4 py-3 border-b flex gap-2">
                <input
                  className="w-full rounded border px-3 py-2"
                  placeholder="Search by ID or name…"
                  value={modalQ}
                  onChange={(e) => {
                    setModalQ(e.target.value);
                    setPage(1);
                  }}
                />
                <div className="min-w-[12rem] -mb-4">
                  <SelectInput
                    className="h-11 py-0 text-sm"
                    options={catOptions}
                    value={cat}
                    onChange={(v) => {
                      setCat(String(v));
                      setPage(1);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Scrollable content area — with min-height para hindi nagshi-shrink */}
            <div className="flex-1 overflow-auto p-4 pt-3 min-h-[360px]">
              <div role="table" className="rounded-xl border text-sm bg-white">
                <div
                  role="row"
                  className="grid grid-cols-[6rem,1fr,12rem,7rem] bg-slate-50 border-b"
                >
                  <div
                    role="columnheader"
                    className="px-3 py-2 text-left font-medium text-slate-700"
                  >
                    ID
                  </div>
                  <div
                    role="columnheader"
                    className="px-3 py-2 text-left font-medium text-slate-700"
                  >
                    Name
                  </div>
                  <div
                    role="columnheader"
                    className="px-3 py-2 text-left font-medium text-slate-700"
                  >
                    Category / Brand
                  </div>
                  <div
                    role="columnheader"
                    className="px-3 py-2 text-right font-medium text-slate-700"
                  >
                    Action
                  </div>
                </div>
                <div role="rowgroup">
                  {pageData.items.map((p) => (
                    <div
                      role="row"
                      key={p.id}
                      className="grid grid-cols-[6rem,1fr,12rem,7rem] border-t bg-white"
                    >
                      <div
                        role="cell"
                        className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap"
                      >
                        #{p.id}
                      </div>
                      <div role="cell" className="px-3 py-2">
                        <div className="truncate" title={p.name}>
                          {p.name}
                        </div>
                      </div>
                      <div role="cell" className="px-3 py-2 text-slate-500">
                        <div
                          className="truncate"
                          title={p.category?.name ?? p.brand?.name ?? ""}
                        >
                          {p.category?.name ?? p.brand?.name ?? ""}
                        </div>
                      </div>
                      <div role="cell" className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="rounded-lg border px-2.5 py-1.5 text-xs hover:bg-slate-50"
                          onClick={() => {
                            setSelected(p);
                            setShowModal(false);
                            setQuery("");
                            setOpenList(false);
                            onSelect?.(p);
                          }}
                        >
                          Select
                        </button>
                      </div>
                    </div>
                  ))}
                  {pageData.items.length === 0 && (
                    <div role="row" className="grid grid-cols-1 border-t">
                      <div
                        role="cell"
                        className="px-3 py-6 text-center text-slate-500"
                      >
                        No results
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between mt-3">
                <div className="text-xs text-slate-600">
                  Page {page} of {totalPages} • {pageData.total} items
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={disabled || page <= 1}
                  >
                    ◀ Prev
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={disabled || page >= totalPages}
                  >
                    Next ▶
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
