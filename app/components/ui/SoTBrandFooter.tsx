type SoTBrandFooterProps = {
  ownerName?: string;
  className?: string;
};

export function SoTBrandFooter({
  ownerName = "John Michael Benito",
  className = "",
}: SoTBrandFooterProps) {
  return (
    <div
      className={`print:hidden ${className}`.trim()}
      aria-hidden="true"
    >
      <div className="mx-auto w-full max-w-6xl border-t border-slate-200/70 px-5 py-2 text-center text-[10px] font-medium text-slate-500">
        <span className="text-slate-400">Built by</span>{" "}
        <span className="text-slate-700">JM Web Tech</span>{" "}
        <span aria-hidden="true" className="text-slate-300">
          •
        </span>{" "}
        <span className="text-slate-600">{ownerName}</span>{" "}
        <span aria-hidden="true" className="text-slate-300">
          •
        </span>{" "}
        <span className="text-slate-400">Need a custom system?</span>
      </div>
    </div>
  );
}
