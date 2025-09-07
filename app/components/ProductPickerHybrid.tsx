import * as React from "react";

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type ProductRow = {
  id: number;
  name: string;
  brand?: { name: string | null } | null;
};

export function ProductPickerHybrid({ name }: { name: string }) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<ProductRow[]>([]);
  const [openList, setOpenList] = React.useState(false);
  const [selected, setSelected] = React.useState<ProductRow | null>(null);
  const debounced = useDebounced(query, 200);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!debounced) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      const res = await fetch(
        `/resources/products-search?q=${encodeURIComponent(
          debounced
        )}&pageSize=10`,
        { signal: ctrl.signal }
      );
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.items as ProductRow[]);
      setOpenList(true);
    })().catch(() => {});
    return () => ctrl.abort();
  }, [debounced]);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpenList(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const [showModal, setShowModal] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pageData, setPageData] = React.useState<{
    items: ProductRow[];
    total: number;
    pageSize: number;
  }>({
    items: [],
    total: 0,
    pageSize: 20,
  });
  const [modalQ, setModalQ] = React.useState("");
  const debouncedModalQ = useDebounced(modalQ, 250);

  React.useEffect(() => {
    if (!showModal) return;
    const ctrl = new AbortController();
    (async () => {
      const url = `/resources/products-search?q=${encodeURIComponent(
        debouncedModalQ
      )}&page=${page}&pageSize=${pageData.pageSize}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return;
      const data = await res.json();
      setPageData({
        items: data.items,
        total: data.total,
        pageSize: data.pageSize,
      });
    })().catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, page, debouncedModalQ]);

  React.useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showModal]);

  const totalPages = Math.max(1, Math.ceil(pageData.total / pageData.pageSize));

  return (
    <div className="text-sm" ref={boxRef}>
      <div className="flex items-end justify-between gap-3">
        <label className="flex-1">
          <div className="text-slate-700">Product</div>
          <input type="hidden" name={name} value={selected?.id ?? ""} />
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="Type ID or name…"
            value={selected ? `${selected.id} — ${selected.name}` : query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
              setOpenList(true);
            }}
            onFocus={() => !selected && setOpenList(true)}
          />
        </label>
        <button
          type="button"
          className="rounded-xl border px-3 py-2 text-xs bg-white hover:bg-slate-50"
          onClick={() => {
            setShowModal(true);
            setPage(1);
            setModalQ("");
          }}
        >
          Browse…
        </button>
      </div>

      {openList && !selected && results.length > 0 && (
        <div className="mt-1 max-h-64 overflow-auto rounded-xl border bg-white shadow-lg">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 hover:bg-slate-50"
              onClick={() => {
                setSelected(p);
                setOpenList(false);
              }}
            >
              <span className="font-mono text-xs text-slate-500">#{p.id}</span>
              <span className="flex-1 text-left px-3">{p.name}</span>
              <span className="text-[11px] text-slate-500">
                {p.brand?.name ?? ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {openList && !selected && query && results.length === 0 && (
        <div className="mt-1 rounded-xl border bg-white px-3 py-2 text-slate-500">
          No matches
        </div>
      )}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Dismiss modal"
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowModal(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowModal(false);
              }
            }}
          />
          <div
            className="relative z-10 w-full max-w-3xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[80vh] overscroll-contain"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            {/* Sticky title + search */}
            <div className="sticky top-0 z-20 bg-white">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="font-semibold">Browse Products</div>
                <button
                  className="text-slate-500 hover:text-slate-700"
                  onClick={() => setShowModal(false)}
                >
                  ✕
                </button>
              </div>
              <div className="px-4 py-3 border-b">
                <input
                  className="w-full rounded border px-3 py-2"
                  placeholder="Search by ID or name…"
                  value={modalQ}
                  onChange={(e) => {
                    setModalQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
            {/* Scrollable content area */}
            <div className="flex-1 overflow-auto p-4 pt-3">
              <div role="table" className="rounded-xl border text-sm bg-white">
                {/* Regular (non-sticky) header row */}
                <div
                  role="row"
                  className="grid grid-cols-[6rem,1fr,10rem,7rem] bg-slate-50 border-b"
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
                    Brand
                  </div>
                  <div
                    role="columnheader"
                    className="px-3 py-2 text-right font-medium text-slate-700"
                  >
                    Action
                  </div>
                </div>
                {/* Body */}
                <div role="rowgroup">
                  {pageData.items.map((p) => (
                    <div
                      role="row"
                      key={p.id}
                      className="grid grid-cols-[6rem,1fr,10rem,7rem] border-t bg-white"
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
                        <div className="truncate" title={p.brand?.name ?? ""}>
                          {p.brand?.name ?? ""}
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
                    disabled={page <= 1}
                  >
                    ◀ Prev
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
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
