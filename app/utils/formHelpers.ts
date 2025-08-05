// app/utils/formHelpers.ts

/**
 * Returns a setter function for use in custom inputs.
 * Example: onChange={makeFormFieldSetter('unit', setFormData)}
 */
export function makeFormFieldSetter(
  field: string,
  setFormData: React.Dispatch<React.SetStateAction<Record<string, string>>>
) {
  return (val: string | number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: String(val),
    }));
  };
}

/**
 * Example: Returns a setter that supports numbers if needed
 */
export function makeTypedFormFieldSetter<T>(
  field: string,
  setFormData: React.Dispatch<React.SetStateAction<T>>,
  coerce?: (val: string | number) => any // optional coercion
) {
  return (val: string | number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: coerce ? coerce(val) : val,
    }));
  };
}

export function ensureArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : v ? [v] : [];
}
