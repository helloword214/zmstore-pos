import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

type SoTDropdownOption = {
  value: string | number;
  label: string;
  style?: React.CSSProperties;
};

type SoTDropdownProps = {
  id?: string;
  name?: string;
  label?: string;
  options: SoTDropdownOption[];
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: string | number) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
};

export function SoTDropdown({
  id,
  name,
  label,
  options,
  value,
  defaultValue,
  onChange,
  hint,
  error,
  disabled = false,
  className = "",
}: SoTDropdownProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [inputMode, setInputMode] = useState<"mouse" | "keyboard" | null>(null);
  const [internalValue, setInternalValue] = useState<string | number>(
    defaultValue ?? ""
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const buttonId = id || name;
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value ?? "" : internalValue;

  const selectedOption = options.find(
    (opt) => String(opt.value) === String(currentValue)
  );
  const displayValue = selectedOption ? selectedOption.label : options[0]?.label || "-- Select --";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
        setHighlightedIndex(null);
        setInputMode(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (disabled) {
      setShowDropdown(false);
      setHighlightedIndex(null);
      setInputMode(null);
    }
  }, [disabled]);

  useEffect(() => {
    if (!isControlled) {
      setInternalValue(defaultValue ?? "");
    }
  }, [defaultValue, isControlled]);

  useEffect(() => {
    if (highlightedIndex == null || !listRef.current) return;
    const child = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    setInputMode("keyboard");
    if (!showDropdown) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setShowDropdown(true);
        setHighlightedIndex(0);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev == null || prev === options.length - 1 ? 0 : prev + 1
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev == null || prev === 0 ? options.length - 1 : prev - 1
      );
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (highlightedIndex == null) return;
      const option = options[highlightedIndex];
      if (!option) return;
      if (!isControlled) setInternalValue(option.value);
      onChange?.(option.value);
      setShowDropdown(false);
      setInputMode(null);
      return;
    }

    if (e.key === "Escape") {
      setShowDropdown(false);
      setInputMode(null);
    }
  }

  return (
    <div className="relative space-y-1" ref={wrapperRef}>
      {label ? (
        <label
          htmlFor={buttonId}
          className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          {label}
        </label>
      ) : null}

      <button
        id={buttonId}
        type="button"
        disabled={disabled}
        className={clsx(
          "flex h-9 w-full items-center justify-between rounded-xl border bg-white px-3 text-left text-sm text-slate-900 shadow-sm transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
          disabled && "cursor-not-allowed bg-slate-100 text-slate-400 hover:bg-slate-100",
          error ? "border-rose-300 bg-rose-50" : "border-slate-300 hover:bg-slate-50/50",
          className
        )}
        onClick={() => {
          if (disabled) return;
          setShowDropdown((prev) => !prev);
        }}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={showDropdown}
        aria-controls={buttonId ? `${buttonId}-listbox` : undefined}
      >
        <span
          className="truncate"
          style={selectedOption?.style || (!selectedOption && options[0]?.style) || undefined}
        >
          {displayValue}
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
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showDropdown && !disabled ? (
        <ul
          id={buttonId ? `${buttonId}-listbox` : undefined}
          ref={listRef}
          className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg"
          role="listbox"
          onMouseLeave={() => setInputMode(null)}
        >
          {options.length === 0 ? (
            <li className="px-2.5 py-2 text-slate-500 select-none">No options</li>
          ) : null}
          {options.map((opt, index) => {
            const isSelected = String(opt.value) === String(currentValue);
            const isKeyboardActive = inputMode === "keyboard" && highlightedIndex === index;
            const isMouseActive = inputMode === "mouse" && highlightedIndex === index;

            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => {
                  if (!isControlled) setInternalValue(opt.value);
                  onChange?.(opt.value);
                  setShowDropdown(false);
                  setHighlightedIndex(index);
                  setInputMode(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!isControlled) setInternalValue(opt.value);
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
                  isKeyboardActive
                    ? "bg-indigo-600 text-white"
                    : isMouseActive
                    ? "bg-slate-50"
                    : "hover:bg-slate-50",
                  isSelected && !isKeyboardActive && "bg-indigo-50 text-indigo-700"
                )}
                style={opt.style}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected ? (
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
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {name && !disabled ? (
        <input type="hidden" name={name} value={String(currentValue ?? "")} />
      ) : null}
    </div>
  );
}
