import { SoTButton } from "~/components/ui/SoTButton";

type SoTPagedTableFooterProps = {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
};

export function SoTPagedTableFooter({
  page,
  totalPages,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: SoTPagedTableFooterProps) {
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
      <p className="text-xs text-slate-500">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <SoTButton
          type="button"
          variant="secondary"
          disabled={prevDisabled ?? page <= 1}
          onClick={onPrev}
          className="h-8 px-2 py-0 text-xs"
        >
          Previous
        </SoTButton>
        <SoTButton
          type="button"
          variant="secondary"
          disabled={nextDisabled ?? page >= totalPages}
          onClick={onNext}
          className="h-8 px-2 py-0 text-xs"
        >
          Next
        </SoTButton>
      </div>
    </div>
  );
}
