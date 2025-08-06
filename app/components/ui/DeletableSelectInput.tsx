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
    <div className="mb-4 relative" ref={wrapperRef}>
      {label && (
        <label className="block text-sm font-medium mb-1 text-gray-700">
          {label}
        </label>
      )}
      <button
        type="button"
        className={clsx(
          "w-full p-2 border rounded shadow-sm flex justify-between items-center text-left",
          error
            ? "border-red-500 bg-red-50 text-gray-800"
            : "border-gray-300 focus:border-blue-500 text-gray-800",
          className
        )}
        onClick={() => setShowDropdown((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={showDropdown}
      >
        <span style={selectedOption?.style}>
          {displayValue || "-- Select --"}
        </span>
        <svg
          className={clsx("w-4 h-4 ml-2", showDropdown && "rotate-180")}
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
          className="absolute mt-1 w-full max-h-48 overflow-auto z-10 text-sm bg-white border border-gray-300 shadow-md rounded text-gray-800"
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
                "px-3 py-2 cursor-pointer transition select-none flex justify-between items-center",
                inputMode === "keyboard" && highlightedIndex === index
                  ? "bg-blue-600 text-white"
                  : inputMode === "mouse" && highlightedIndex === index
                  ? "bg-blue-100"
                  : "hover:bg-blue-100"
              )}
            >
              <span className="truncate" style={opt.style}>
                {opt.label}
              </span>
              {deletableValues.map(String).includes(String(opt.value)) &&
                onDeleteOption && (
                  <button
                    type="button"
                    className="ml-2 text-red-500 hover:text-red-700 text-xs"
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

      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
}
