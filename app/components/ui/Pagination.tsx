// app/components/ui/Pagination.tsx

import { Button } from "~/components/ui/Button";

interface Props {
  currentPage: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const maxButtons = 5;
  const start = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  const end = Math.min(totalPages, start + maxButtons - 1);

  return (
    <div className="flex flex-col items-center gap-4 mt-6">
      <p className="text-sm text-gray-500">
        Page {currentPage} of {totalPages}
      </p>
      <div className="flex flex-wrap justify-center gap-1">
        <Button
          className="rounded-full px-4"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
        >
          ⏮ First
        </Button>
        <Button
          className="rounded-full px-4"
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          disabled={currentPage === 1}
        >
          Prev
        </Button>

        {start > 1 && <span className="px-2 text-gray-400">...</span>}

        {Array.from({ length: end - start + 1 }, (_, i) => start + i).map(
          (page) => (
            <Button
              key={page}
              onClick={() => onPageChange(page)}
              className={
                "rounded-full px-4 " +
                (page === currentPage
                  ? "bg-neutral-800 text-white font-bold"
                  : "bg-white border text-gray-700 hover:bg-gray-100")
              }
            >
              {page}
            </Button>
          )
        )}

        {end < totalPages && <span className="px-2 text-gray-400">...</span>}

        <Button
          className="rounded-full px-4"
          onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
          disabled={currentPage === totalPages}
        >
          Next
        </Button>
        <Button
          className="rounded-full px-4"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
        >
          ⏭ Last
        </Button>
      </div>
    </div>
  );
}
