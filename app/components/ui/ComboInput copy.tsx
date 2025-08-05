import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

interface Option {
  label: string;
  value: string | number;
}

interface Props {
  label?: string;
  placeholder?: string;
  options: Option[];
  selectedId: string;
  customName: string;
  onSelect: (value: { selectedId: string; customName: string }) => void;
  error?: string;
}

export function ComboInput({
  label,
  placeholder,
  options,
  selectedId,
  customName,
  onSelect,
  error,
}: Props) {
  const [inputValue, setInputValue] = useState(customName);
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(inputValue.toLowerCase())
  );

  const handleSelect = (opt: Option) => {
    onSelect({ selectedId: String(opt.value), customName: "" });
    setInputValue(opt.label);
    setShowDropdown(false);
  };

  const handleCreate = () => {
    onSelect({ selectedId: "", customName: inputValue });
    setShowDropdown(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (selectedId) {
      const selected = options.find((o) => String(o.value) === selectedId);
      if (selected) {
        setInputValue(selected.label);
        return;
      }
    }
    setInputValue(customName || "");
  }, [selectedId, customName, options]);

  return (
    <div
      className="mb-4 relative"
      ref={wrapperRef}
      aria-haspopup="listbox"
      aria-expanded={showDropdown}
    >
      {label && (
        <label className="block text-sm font-medium mb-1 text-gray-700">
          {label}
        </label>
      )}
      <input
        type="text"
        value={inputValue}
        placeholder={placeholder || "Type or select..."}
        onChange={(e) => {
          setInputValue(e.target.value);
          setShowDropdown(true);
          onSelect({ selectedId: "", customName: e.target.value });
        }}
        onFocus={() => setShowDropdown(true)}
        className={clsx(
          "w-full p-2 border rounded shadow-sm",
          error
            ? "border-red-500 bg-red-50 text-gray-800"
            : "border-gray-300 focus:border-blue-500"
        )}
      />
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}

      {showDropdown && inputValue.trim() !== "" && (
        <ul
          className="absolute mt-1 border bg-slate-400 shadow-sm rounded max-h-48 overflow-auto z-10 w-full"
          role="listbox"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={String(opt.value) === selectedId} // ✅ this is required
                tabIndex={0}
                onClick={() => handleSelect(opt)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleSelect(opt);
                }}
                className="px-3 py-2 hover:bg-gray-100 cursor-pointer focus:outline-none focus:bg-gray-100"
              >
                {opt.label}
              </li>
            ))
          ) : (
            <li
              role="option"
              aria-selected="false" // ✅ required even for custom/creatable
              tabIndex={0}
              onClick={handleCreate}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleCreate();
              }}
              className="px-3 py-2 text-blue-600 hover:bg-gray-100 cursor-pointer focus:outline-none focus:bg-gray-100"
            >
              Create “{inputValue}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
