import { useState, useEffect } from "react";
import { SelectInput } from "./SelectInput";
import { TextInput } from "./TextInput";

interface SelectOption {
  label: string;
  value: string | number;
}

interface SmartSelectProps {
  name: string;
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  customValueLabel?: string;
  placeholder?: string;
  error?: string;
  customInputValue?: string;
  onCustomInputChange?: (val: string) => void;
}

export function SmartSelectInput({
  name,
  label,
  options,
  value,
  onChange,
  customValueLabel = "Other",
  placeholder,
  error,
  customInputValue = "",
  onCustomInputChange,
}: SmartSelectProps) {
  const [selectedOption, setSelectedOption] = useState<string>("");

  useEffect(() => {
    if (!value) {
      setSelectedOption("");
    } else if (
      value === "__custom__" ||
      !options.some((opt) => String(opt.value) === String(value))
    ) {
      setSelectedOption("__custom__");
    } else {
      setSelectedOption(String(value));
    }
  }, [value, options]);

  const isCustomSelected = selectedOption === "__custom__";

  return (
    <div className="mb-4">
      <SelectInput
        name={`${name}_select`}
        label={label}
        value={selectedOption}
        onChange={(val) => {
          const valStr = String(val);
          if (valStr === "__custom__") {
            setSelectedOption("__custom__");
            onChange("__custom__");
          } else {
            setSelectedOption(valStr);
            onChange(valStr);
            onCustomInputChange?.(""); // Clear custom input
          }
        }}
        options={[
          { label: "-- Select --", value: "" },
          ...options.map((opt) => ({
            label: opt.label,
            value: String(opt.value),
          })),
          { label: customValueLabel, value: "__custom__" },
        ]}
        error={error}
      />

      {isCustomSelected && (
        <>
          <TextInput
            name={`${name}_custom`}
            placeholder={
              placeholder || `Type new ${label?.toLowerCase() || "value"}`
            }
            value={customInputValue}
            onChange={(e) => {
              const val = e.target.value;
              onCustomInputChange?.(val);
              onChange("__custom__");
            }}
          />
          <p className="text-xs text-gray-500 mt-1">
            Enter custom {label?.toLowerCase() || "value"} here.
          </p>
        </>
      )}

      <input type="hidden" name={name} value={value || ""} />
    </div>
  );
}
