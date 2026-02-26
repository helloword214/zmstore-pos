interface ManageOptionModalProps {
  title: string;
  options: { value: string | number; label: string }[];
  onDelete: (value: string | number) => void;
  onClose: () => void;
}

export function ManageOptionModal({
  title,
  options,
  onDelete,
  onClose,
}: ManageOptionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">{title}</h2>

        <ul className="max-h-60 overflow-y-auto divide-y divide-slate-200">
          {options.map((opt) => (
            <li
              key={opt.value}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="text-slate-800 truncate">{opt.label}</span>
              <button
                type="button"
                onClick={() => {
                  const confirmDelete = window.confirm(
                    `Are you sure you want to delete "${opt.label}"?`
                  );
                  if (confirmDelete) onDelete(opt.value);
                }}
                className="text-rose-600 hover:text-rose-700 text-xs rounded px-2 py-1 hover:bg-rose-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-indigo-600 hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
