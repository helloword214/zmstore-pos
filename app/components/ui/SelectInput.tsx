import { SoTDropdown } from "./SoTDropdown";

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
  defaultValue?: string | number;
  onChange?: (value: string | number) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function SelectInput({
  label,
  options,
  value,
  defaultValue,
  onChange,
  error,
  disabled,
  className,
  name,
}: Props) {
  return (
    <SoTDropdown
      name={name}
      label={label}
      options={options}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      error={error}
      disabled={disabled}
      className={className}
    />
  );
}
