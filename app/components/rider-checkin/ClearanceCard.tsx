// UPDATED FILE (NEW FILE): app/components/rider-checkin/ClearanceCard.tsx
import * as React from "react";

export type ClearanceIntentUI = "OPEN_BALANCE" | "PRICE_BARGAIN";

function MiniPill({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "amber" | "indigo" | "rose" | "emerald";
  children: React.ReactNode;
}) {
  const cls =
    tone === "indigo"
      ? "border-indigo-200 bg-indigo-50 text-indigo-800"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}
    >
      {children}
    </span>
  );
}

export function normalizeClearanceMessage(s?: string) {
  const msg = String(s || "").trim();
  return msg.slice(0, 200);
}

export function getDefaultIntent(
  customerId: number | null | undefined,
  current?: ClearanceIntentUI | null,
): ClearanceIntentUI {
  if (current) return current;
  return customerId ? "OPEN_BALANCE" : "PRICE_BARGAIN";
}

export function clampCashToTotal(
  total: number,
  rawStr: string | number | null | undefined,
) {
  const cleaned = String(rawStr ?? "").replace(/[^0-9.]/g, "");
  let raw = cleaned.trim() === "" ? total : parseFloat(cleaned);
  if (!Number.isFinite(raw) || raw < 0) raw = 0;
  const clamped = Math.max(0, Math.min(total, raw));
  return { clamped, formatted: clamped.toFixed(2) };
}

export function ClearanceCard(props: {
  id: string; // unique key for open map (ex: `p:${orderId}` or `q:${rec.key}`)
  pending: boolean;
  locked: boolean;
  busy?: boolean;
  // already formatted e.g. peso(rem)
  // NOTE: optional to avoid duplicate "Remaining" lines when the parent page already shows it
  remainingLabel?: string | null;
  intent: ClearanceIntentUI;
  intentDisabledOpenBalance?: boolean; // (ex: !customerId)
  message: string;
  onIntent: (next: ClearanceIntentUI) => void;
  onMessage: (next: string) => void;
  onSend?: () => void; // hide send when pending
  statusNode: React.ReactNode; // StatusPill row (PENDING/REJECTED/VOIDED/etc)
  noteNode?: React.ReactNode; // “Not yet sent” / “Sent to manager”
  extraNode?: React.ReactNode; // voided button etc
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {props.remainingLabel ? (
            <MiniPill tone="amber">Remaining {props.remainingLabel}</MiniPill>
          ) : null}
          {props.statusNode}
          {props.noteNode ?? null}
        </div>
        <button
          type="button"
          className="text-[11px] text-slate-600 hover:text-slate-900"
          onClick={props.onToggle}
        >
          {props.open ? "Hide" : "Details"}
        </button>
      </div>

      {props.open ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-700">
            <span className="text-slate-500">Intent:</span>

            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                disabled={props.locked || !!props.intentDisabledOpenBalance}
                checked={props.intent === "OPEN_BALANCE"}
                onChange={() => props.onIntent("OPEN_BALANCE")}
              />
              OPEN_BALANCE
              {props.intentDisabledOpenBalance ? " (needs customer)" : ""}
            </label>

            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                disabled={props.locked}
                checked={props.intent === "PRICE_BARGAIN"}
                onChange={() => props.onIntent("PRICE_BARGAIN")}
              />
              PRICE_BARGAIN
            </label>
          </div>

          <label className="block">
            <div className="text-[11px] text-slate-500">
              Message to manager (required)
            </div>
            <input
              type="text"
              disabled={props.locked}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] disabled:bg-slate-50"
              value={props.message}
              onChange={(e) =>
                props.onMessage(normalizeClearanceMessage(e.target.value))
              }
            />
          </label>

          {!props.pending && props.onSend ? (
            <div className="mt-1">
              <button
                type="button"
                disabled={!!props.busy || props.locked}
                onClick={props.onSend}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                Send for clearance
              </button>
            </div>
          ) : null}

          {props.extraNode ?? null}
        </div>
      ) : null}
    </div>
  );
}
