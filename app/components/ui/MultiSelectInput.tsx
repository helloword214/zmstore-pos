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
    <div className="mb-4 relative" ref={wrapperRef}>
      {label && (
        <label className="block text-sm font-medium mb-1 text-slate-700">
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
          "w-full rounded-xl border bg-white px-3 py-2.5 text-slate-900 shadow-sm transition",
          "placeholder:text-slate-400",
          "focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 hover:bg-slate-50/50",
          error ? "border-rose-300 bg-rose-50" : "border-slate-300"
        )}
      />

      {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}

      {/* dropdown */}
      {showDropdown && inputValue.trim() !== "" && (
        <ul
          ref={listRef}
          className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {filteredOptions.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => handleSelect(opt)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleSelect(opt);
                }}
                className="w-full text-left rounded-xl px-2.5 py-2 text-sm text-slate-900 hover:bg-slate-50"
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
                  className="w-full text-left rounded-xl px-2.5 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
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
