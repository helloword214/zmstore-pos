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
  const half = Math.floor(maxButtons / 2);

  let start = Math.max(1, currentPage - half);
  const end = Math.min(totalPages, start + maxButtons - 1);

  if (end - start < maxButtons - 1) {
    start = Math.max(1, end - maxButtons + 1);
  }

  return (
    <div className="flex flex-wrap justify-center items-center gap-4 mt-6 text-sm text-gray-700">
      {/* Page Info */}
      <p className="text-gray-500">
        Page {currentPage} of {totalPages}
      </p>

      {/* Pagination Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-2 py-1 text-gray-600 disabled:text-gray-400"
        >
          Prev
        </button>

        {start > 1 && <span className="px-1">...</span>}

        {Array.from({ length: end - start + 1 }, (_, i) => start + i).map(
          (page) => (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={`px-2 py-1 rounded ${
                page === currentPage
                  ? "bg-neutral-800 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {page}
            </button>
          )
        )}

        {end < totalPages && <span className="px-1">...</span>}

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-2 py-1 text-gray-600 disabled:text-gray-400"
        >
          Next
        </button>
      </div>
    </div>
  );
}
