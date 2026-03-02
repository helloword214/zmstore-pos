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
    <div className="relative space-y-1" ref={wrapperRef}>
      {label && (
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          {label}
        </label>
      )}

      {/* selected chips */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {selected.map((tag) => (
          <span
            key={tag.value}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-sm text-indigo-700 ring-1 ring-inset ring-indigo-200"
          >
            <span className="truncate">{tag.label}</span>
            <button
              type="button"
              onClick={() => handleRemove(tag.value)}
              className="ml-0.5 inline-grid h-4 w-4 place-items-center rounded-full text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700"
              title="Remove"
              aria-label={`Remove ${tag.label}`}
            >
              ×
            </button>
            {/* Hidden input for form submission */}
            <input type="hidden" name={name} value={tag.value} />
          </span>
        ))}
      </div>

      {/* input */}
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
          "h-9 w-full rounded-xl border bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors duration-150",
          "placeholder:text-slate-400",
          "focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 hover:bg-slate-50/50",
          error ? "border-rose-300 bg-rose-50" : "border-slate-300"
        )}
      />

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {/* dropdown */}
      {showDropdown && inputValue.trim() !== "" && (
        <ul
          ref={listRef}
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg"
        >
          {filteredOptions.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => handleSelect(opt)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleSelect(opt);
                }}
                className="h-8 w-full rounded-xl px-2.5 text-left text-sm text-slate-900 transition-colors duration-150 hover:bg-slate-50"
              >
                {opt.label}
              </button>
            </li>
          ))}

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
                  className="h-8 w-full rounded-xl px-2.5 text-left text-sm text-indigo-600 transition-colors duration-150 hover:bg-indigo-50"
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
