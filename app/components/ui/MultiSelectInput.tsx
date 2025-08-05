import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

interface Option {
  label: string;
  value: string;
}

interface Props {
  name: string;
  label?: string;
  options: Option[];
  selected: Option[];
  onChange: (values: Option[]) => void;
  onCustomInput?: (input: string) => Promise<Option>;
  placeholder?: string;
  error?: string;
}

export function MultiSelectInput({
  name,
  label,
  options,
  selected,
  onChange,
  onCustomInput,
  placeholder,
  error,
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filteredOptions = options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(inputValue.toLowerCase()) &&
      !selected.find((s) => s.value === opt.value)
  );

  const handleSelect = (opt: Option) => {
    onChange([...selected, opt]);
    setInputValue("");
    setShowDropdown(false);
  };

  const handleRemove = (val: string) => {
    onChange(selected.filter((s) => s.value !== val));
  };

  const handleCreate = async () => {
    if (!onCustomInput) return;
    const created = await onCustomInput(inputValue);
    if (created) {
      onChange([...selected, created]);
      setInputValue("");
      setShowDropdown(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="mb-4" ref={wrapperRef}>
      {label && (
        <label className="block text-sm font-medium mb-1 text-gray-700">
          {label}
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2">
        {selected.map((tag) => (
          <span
            key={tag.value}
            className="flex items-center bg-blue-100 text-blue-800 text-sm px-2 py-1 rounded-full"
          >
            {tag.label}
            <button
              type="button"
              onClick={() => handleRemove(tag.value)}
              className="ml-1 text-xs text-red-500 hover:text-red-700"
            >
              ×
            </button>
            {/* Hidden input for form submission */}
            <input type="hidden" name={name} value={tag.value} />
          </span>
        ))}
      </div>

      <input
        type="text"
        value={inputValue}
        placeholder={placeholder || "Type or select..."}
        onChange={(e) => {
          setInputValue(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => setShowDropdown(true)}
        className={clsx(
          "w-full p-2 border rounded shadow-sm text-gray-800",
          error
            ? "border-red-500 bg-red-50"
            : "border-gray-300 bg-white focus:border-blue-500 focus:outline-none"
        )}
      />

      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}

      {showDropdown && inputValue.trim() !== "" && (
        <ul
          ref={listRef}
          className="absolute z-10 mt-1 w-full max-h-48 overflow-auto text-sm bg-white text-gray-800 border border-gray-300 shadow-md rounded"
        >
          {/* Show matching suggestions */}
          {filteredOptions.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => handleSelect(opt)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleSelect(opt);
                }}
                className="w-full text-left px-3 py-2 hover:bg-blue-100"
              >
                {opt.label}
              </button>
            </li>
          ))}

          {/* Show "Create" button if input doesn't match any option */}
          {onCustomInput &&
            !options.some(
              (opt) =>
                opt.label.toLowerCase() === inputValue.trim().toLowerCase()
            ) && (
              <li key="create-option">
                <button
                  type="button"
                  onClick={handleCreate}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleCreate();
                  }}
                  className="w-full text-left px-3 py-2 text-blue-600 hover:bg-blue-100"
                >
                  Create “{inputValue.trim()}”
                </button>
              </li>
            )}
        </ul>
      )}
    </div>
  );
}
