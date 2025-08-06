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
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-md w-full max-w-sm p-4">
        <h2 className="text-lg font-semibold mb-4">{title}</h2>

        <ul className="max-h-60 overflow-y-auto space-y-2">
          {options.map((opt) => (
            <li
              key={opt.value}
              className="flex items-center justify-between text-sm border-b pb-1 text-green-800"
            >
              <span>{opt.label}</span>
              <button
                type="button"
                onClick={() => {
                  const confirmDelete = window.confirm(
                    `Are you sure you want to delete "${opt.label}"?`
                  );
                  if (confirmDelete) {
                    onDelete(opt.value);
                  }
                }}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 text-right">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-blue-600 hover:underline"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
