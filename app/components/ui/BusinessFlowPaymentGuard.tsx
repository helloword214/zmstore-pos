type BusinessFlowPaymentGuardProps = {
  open: boolean;
  total: number;
  cash: number;
  remaining: number;
  mode: "quick" | "parent";
  peso: (n: number) => string;
  onTreatAsCredit: () => void;
  onSetFullCash: () => void;
  onClose: () => void;
  /**
   * Kung false (lalo na sa quick mode), hindi puwedeng mag "Treat as Credit".
   * Gamit sa mga quick sales na wala pang customer.
   */
  canTreatAsCredit?: boolean;
};

export function BusinessFlowPaymentGuard(props: BusinessFlowPaymentGuardProps) {
  const {
    open,
    total,
    cash,
    remaining,
    mode,
    peso,
    onTreatAsCredit,
    onSetFullCash,
    onClose,
    canTreatAsCredit = true,
  } = props;

  if (!open) return null;

  const totalStr = peso(total);
  const cashStr = peso(cash);
  const remainingStr = peso(remaining);

  let body: string;
  if (cash <= 0.01) {
    body =
      `Total due: ${totalStr}\n` +
      `Na-encode na cash: ${cashStr}.\n\n` +
      `Sigurado ka bang walang kahit magkano na binayad?`;
  } else {
    const percentPaid = total > 0 ? (cash / total) * 100 : 0;
    const pct = `${percentPaid.toFixed(0)}%`;

    body =
      `Total due: ${totalStr}\n` +
      `Na-encode na cash: ${cashStr} (${pct} paid, kulang ${remainingStr}).\n\n` +
      `Sigurado ka bang ganyan lang talaga ang binayad?`;
  }

  const title =
    mode === "quick"
      ? "Review roadside payment"
      : "Review parent order payment";

  // Credit button disabled kung quick-mode at hindi puwedeng mag-credit
  // (e.g. walang customer selected)
  const creditDisabled = mode === "quick" && !canTreatAsCredit;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center bg-black/30">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-lg m-3">
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <p className="text-xs text-slate-600 mb-3 whitespace-pre-line">
          {body}
        </p>

        <div className="space-y-2 text-xs">
          <button
            type="button"
            disabled={creditDisabled}
            className={
              "w-full rounded-lg border px-3 py-2 font-medium " +
              (creditDisabled
                ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                : "border-amber-300 bg-amber-50 text-amber-800")
            }
            onClick={() => {
              if (creditDisabled) return;
              onTreatAsCredit();
              onClose();
            }}
          >
            Treat as Credit (A/R) with remaining balance
          </button>

          {creditDisabled && (
            <p className="text-[11px] text-red-600">
              Credit (A/R) requires selecting a customer for this receipt.
              Please choose a customer first.
            </p>
          )}

          <button
            type="button"
            className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800 font-medium"
            onClick={() => {
              onSetFullCash();
              onClose();
            }}
          >
            Set as FULL CASH (no A/R)
          </button>

          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600"
            onClick={onClose}
          >
            Balikan ko muna (keep current value)
          </button>
        </div>
      </div>
    </div>
  );
}
