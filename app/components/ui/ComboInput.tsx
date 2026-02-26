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
        <label className="block text-sm font-medium mb-1 text-slate-700">
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
          "w-full rounded-xl border bg-white px-3 py-2.5 text-slate-900 shadow-sm transition",
          "placeholder:text-slate-400",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:border-indigo-300",
          error
            ? "border-rose-300 bg-rose-50"
            : "border-slate-300 hover:bg-slate-50/50",
          className
        )}
      />

      {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}

      {showDropdown && inputValue.trim() !== "" && (
        <ul
          ref={listRef}
          id={listboxId}
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg"
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
                  "rounded-xl px-2.5 py-2 text-sm cursor-pointer select-none transition",
                  inputMode === "keyboard" && highlightedIndex === index
                    ? "bg-indigo-600 text-white"
                    : inputMode === "mouse" && highlightedIndex === index
                    ? "bg-slate-50"
                    : "hover:bg-slate-50"
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
              className="rounded-xl px-2.5 py-2 text-sm cursor-pointer select-none text-indigo-600 hover:bg-indigo-50"
            >
              Create “{inputValue}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
