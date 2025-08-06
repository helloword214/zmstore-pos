import { useEffect, useState } from "react";
import { TextInput } from "./TextInput";
import { DeletableSelectInput } from "./DeletableSelectInput";

interface Option {
  label: string;
  value: string | number;
  style?: React.CSSProperties;
}

interface Props {
  name: string;
  label?: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  customValueLabel?: string;
  placeholder?: string;
  error?: string;
  customInputValue?: string;
  onCustomInputChange?: (val: string) => void;
  onDeleteOption?: (value: string | number) => void;
  deletableValues?: (string | number)[];
}

export function DeletableSmartSelectInput({
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
  onDeleteOption,
  deletableValues = [],
}: Props) {
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

  const isCustom = selectedOption === "__custom__";

  return (
    <div className="">
      <DeletableSelectInput
        label={label}
        name={`${name}_select`}
        options={[
          ...options.map((opt) => ({
            label: opt.label,
            value: String(opt.value),
            style: opt.style,
          })),
          ...(onCustomInputChange && customValueLabel
            ? [{ label: customValueLabel, value: "__custom__" }]
            : []),
        ]}
        value={selectedOption}
        onChange={(val) => {
          const valStr = String(val);
          if (valStr === "__custom__") {
            setSelectedOption("__custom__");
            onChange("__custom__");
          } else {
            setSelectedOption(valStr);
            onChange(valStr);
            onCustomInputChange?.("");
          }
        }}
        onDeleteOption={onDeleteOption}
        deletableValues={deletableValues}
        error={error}
      />

      {isCustom && (
        <>
          <TextInput
            name={`${name}_custom`}
            placeholder={
              placeholder || `Type new ${label?.toLowerCase() || "value"}`
            }
            value={customInputValue}
            onChange={(e) => {
              onCustomInputChange?.(e.target.value);
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
