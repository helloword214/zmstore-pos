import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

interface Option {
  value: string | number;
  label: string;
  style?: React.CSSProperties; // Add t
}

interface Props {
  label?: string;
  name?: string;
  options: Option[];
  value?: string | number;
  onChange?: (value: string | number) => void;
  error?: string;
  className?: string;
}

export function SelectInput({
  label,
  options,
  value = "",
  onChange,
  error,
  className,
}: Props) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<"mouse" | "keyboard" | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedOption = options.find(
    (opt) => String(opt.value) === String(value)
  );
  const displayValue = selectedOption ? selectedOption.label : "";

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
        <label className="block text-sm font-medium mb-1 text-slate-700">
          {label}
        </label>
      )}

      <button
        ref={buttonRef}
        type="button"
        className={clsx(
          "w-full rounded-xl border bg-white px-3 py-2.5 text-left text-slate-900 shadow-sm transition",
          "flex items-center justify-between",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:border-indigo-300",
          error
            ? "border-rose-300 bg-rose-50"
            : "border-slate-300 hover:bg-slate-50/50",
          className
        )}
        onClick={() => setShowDropdown((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={showDropdown}
      >
        <span
          className="truncate"
          style={
            selectedOption?.style ||
            (!selectedOption && options[0]?.style) ||
            undefined
          }
        >
          {displayValue || options[0]?.label || "-- Select --"}
        </span>

        <svg
          className={clsx(
            "ml-2 h-4 w-4 flex-none text-slate-500 transition-transform",
            showDropdown && "rotate-180"
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
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
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg"
          role="listbox"
          onMouseLeave={() => setInputMode(null)}
        >
          {options.length === 0 && (
            <li className="px-3 py-2 text-slate-500 select-none">No options</li>
          )}

          {options.map((opt, index) => {
            const isSelected = String(opt.value) === String(value);
            const isKeyboardActive =
              inputMode === "keyboard" && highlightedIndex === index;
            const isMouseActive =
              inputMode === "mouse" && highlightedIndex === index;

            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => {
                  onChange?.(opt.value);
                  setShowDropdown(false);
                  setHighlightedIndex(index);
                  setInputMode(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
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
                  "flex cursor-pointer select-none items-center justify-between rounded-xl px-2.5 py-2 text-sm",
                  isKeyboardActive
                    ? "bg-indigo-600 text-white"
                    : isMouseActive
                    ? "bg-slate-50"
                    : "hover:bg-slate-50",
                  isSelected &&
                    !isKeyboardActive &&
                    "bg-indigo-50 text-indigo-700"
                )}
                style={opt.style}
              >
                <span className="truncate">{opt.label}</span>

                {/* checkmark for selected */}
                {isSelected && (
                  <svg
                    className={clsx(
                      "ml-2 h-4 w-4 flex-none",
                      isKeyboardActive ? "text-white" : "text-indigo-600"
                    )}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
