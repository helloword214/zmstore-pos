import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

interface Option {
  label: string;
  value: string | number;
}

interface Props {
  label?: string;
  name?: string;
  placeholder?: string;
  options: Option[];
  selectedId: string;
  customName: string;
  onSelect: (value: { selectedId: string; customName: string }) => void;
  error?: string;
  className?: string; // ✅ allows external style overrides
}

export function ComboInput({
  label,
  placeholder,
  options,
  selectedId,
  customName,
  onSelect,
  error,
  className,
}: Props) {
  const [inputValue, setInputValue] = useState(customName);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<"mouse" | "keyboard" | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = "combo-options-list";

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(inputValue.toLowerCase())
  );

  const handleSelect = (opt: Option) => {
    onSelect({ selectedId: String(opt.value), customName: "" });
    setInputValue(opt.label);
    setShowDropdown(false);
    setHighlightedIndex(null);
    setInputMode(null);
  };

  const handleCreate = () => {
    onSelect({ selectedId: "", customName: inputValue });
    setShowDropdown(false);
    setHighlightedIndex(null);
    setInputMode(null);
  };

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
        setHighlightedIndex(null);
        setInputMode(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (
      highlightedIndex !== null &&
      listRef.current &&
      listRef.current.children[highlightedIndex]
    ) {
      (
        listRef.current.children[highlightedIndex] as HTMLElement
      ).scrollIntoView({
        block: "nearest",
      });
    }
  }, [highlightedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setInputMode("keyboard");
    if (!showDropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev === null || prev === filteredOptions.length - 1 ? 0 : prev + 1
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev === null || prev === 0 ? filteredOptions.length - 1 : prev - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex !== null) {
        const selected = filteredOptions[highlightedIndex];
        if (selected) handleSelect(selected);
      } else {
        handleCreate();
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setHighlightedIndex(null);
      setInputMode(null);
    }
  };

  return (
    <div
      className="mb-4 relative"
      ref={wrapperRef}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={showDropdown}
      aria-controls={listboxId}
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
          setHighlightedIndex(null);
        }}
        onFocus={() => setShowDropdown(true)}
        onKeyDown={handleKeyDown}
        className={clsx(
          "w-full p-2 border rounded shadow-sm transition text-gray-800",
          error
            ? "border-red-500 bg-red-50"
            : "border-gray-300 bg-white focus:border-blue-500 focus:outline-none", // Add bg-white!
          className
        )}
      />
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}

      {showDropdown && inputValue.trim() !== "" && (
        <ul
          ref={listRef}
          id={listboxId}
          className="absolute mt-1 w-full max-h-48 overflow-auto z-10 text-sm bg-white text-gray-800 border border-gray-300 shadow-md rounded"
          role="listbox"
          onMouseLeave={() => setInputMode(null)}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, index) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={String(opt.value) === selectedId}
                tabIndex={0}
                onClick={() => handleSelect(opt)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleSelect(opt);
                }}
                onMouseEnter={() => {
                  setInputMode("mouse");
                  setHighlightedIndex(index);
                }}
                className={clsx(
                  "px-3 py-2 cursor-pointer transition",
                  inputMode === "keyboard" && highlightedIndex === index
                    ? "bg-blue-600 text-white"
                    : inputMode === "mouse" && highlightedIndex === index
                    ? "bg-blue-100"
                    : "hover:bg-blue-100"
                )}
              >
                {opt.label}
              </li>
            ))
          ) : (
            <li
              role="option"
              aria-selected="false"
              tabIndex={0}
              onClick={handleCreate}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleCreate();
              }}
              className="px-3 py-2 text-blue-600 hover:bg-blue-100 cursor-pointer focus:outline-none transition"
            >
              Create “{inputValue}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
