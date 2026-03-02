import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

interface Option {
  value: string | number;
  label: string;
  style?: React.CSSProperties;
}

interface Props {
  label?: string;
  name?: string;
  options: Option[];
  value?: string | number;
  onChange?: (value: string | number) => void;
  onDeleteOption?: (value: string | number) => void;
  deletableValues?: (string | number)[];
  error?: string;
  className?: string;
}

export function DeletableSelectInput({
  label,
  options,
  value = "",
  onChange,
  onDeleteOption,
  deletableValues = [],
  error,
  className,
}: Props) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<"mouse" | "keyboard" | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedOption = options.find(
    (opt) => String(opt.value) === String(value)
  );
  const displayValue = selectedOption ? selectedOption.label : "";

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
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
      ).scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    setInputMode("keyboard");
    if (!showDropdown) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        setShowDropdown(true);
        setHighlightedIndex(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev === null || prev === options.length - 1 ? 0 : prev + 1
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev === null || prev === 0 ? options.length - 1 : prev - 1
      );
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (highlightedIndex !== null) {
        const opt = options[highlightedIndex];
        if (opt) {
          onChange?.(opt.value);
          setShowDropdown(false);
          setInputMode(null);
        }
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setInputMode(null);
    }
  };

  return (
    <div className="relative space-y-1" ref={wrapperRef}>
      {label && (
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
        </label>
      )}
      <button
        type="button"
        className={clsx(
          "flex h-9 w-full items-center justify-between rounded-xl border bg-white px-3 text-left text-sm text-slate-900 shadow-sm transition-colors duration-150",
          error
            ? "border-rose-300 bg-rose-50"
            : "border-slate-300 hover:bg-slate-50/50",
          "focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1",
          className
        )}
        onClick={() => setShowDropdown((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={showDropdown}
      >
        <span className="truncate" style={selectedOption?.style}>
          {displayValue || "-- Select --"}
        </span>
        <svg
          className={clsx(
            "w-4 h-4 ml-2 text-slate-500 transition-transform",
            showDropdown && "rotate-180"
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {showDropdown && (
        <ul
          ref={listRef}
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-sm text-slate-900 shadow-lg"
          role="listbox"
          onMouseLeave={() => setInputMode(null)}
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-gray-500 select-none">No options</li>
          )}
          {options.map((opt, index) => (
            <li
              key={opt.value}
              role="option"
              style={opt.style}
              aria-selected={String(opt.value) === String(value)}
              tabIndex={0}
              onClick={() => {
                onChange?.(opt.value);
                setShowDropdown(false);
                setHighlightedIndex(index);
                setInputMode(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange?.(opt.value);
                  setShowDropdown(false);
                  setHighlightedIndex(index);
                  setInputMode(null);
                }
              }}
              onMouseEnter={() => {
                setInputMode("mouse");
                setHighlightedIndex(index);
              }}
              className={clsx(
                "flex h-8 cursor-pointer select-none items-center justify-between rounded-xl px-2.5 text-sm transition-colors duration-150",
                inputMode === "keyboard" && highlightedIndex === index
                  ? "bg-indigo-600 text-white"
                  : inputMode === "mouse" && highlightedIndex === index
                  ? "bg-slate-50"
                  : "hover:bg-slate-50"
              )}
            >
              <span className="truncate" style={opt.style}>
                {opt.label}
              </span>
              {deletableValues.map(String).includes(String(opt.value)) &&
                onDeleteOption && (
                  <button
                    type="button"
                    className="ml-2 text-rose-600 hover:text-rose-700 text-xs rounded px-1 py-0.5 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteOption(opt.value);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    aria-label={`Delete ${opt.label}`}
                  >
                    ❌
                  </button>
                )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
