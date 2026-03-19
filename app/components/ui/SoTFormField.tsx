import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

type SoTFormFieldProps = {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  inputId?: string;
};

type SoTFormFieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

function mergeAriaDescribedBy(values: Array<string | undefined>) {
  const tokens = values
    .flatMap((value) => (value ?? "").split(/\s+/))
    .map((token) => token.trim())
    .filter(Boolean);

  return tokens.length > 0 ? Array.from(new Set(tokens)).join(" ") : undefined;
}

export function SoTFormField({
  label,
  children,
  hint,
  error,
  className = "",
  inputId,
}: SoTFormFieldProps) {
  const generatedId = useId().replace(/:/g, "");
  const fallbackControlId = inputId ?? `sot-form-field-${generatedId}`;
  const hintId = hint ? `${fallbackControlId}-hint` : undefined;
  const errorId = error ? `${fallbackControlId}-error` : undefined;

  let controlId: string | undefined;
  let resolvedChildren = children;

  if (Children.count(children) === 1) {
    const child = Children.only(children);
    if (isValidElement<SoTFormFieldControlProps>(child)) {
      controlId = child.props.id ?? fallbackControlId;
      const describedBy = mergeAriaDescribedBy([
        child.props["aria-describedby"],
        hintId,
        errorId,
      ]);

      resolvedChildren = cloneElement(
        child as ReactElement<SoTFormFieldControlProps>,
        {
          id: controlId,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : child.props["aria-invalid"],
        },
      );
    }
  }

  const labelNode = controlId ? (
    <label
      htmlFor={controlId}
      className="text-xs font-semibold uppercase tracking-wide text-slate-600"
    >
      {label}
    </label>
  ) : (
    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
      {label}
    </div>
  );

  return (
    <div className={`space-y-1 ${className}`.trim()}>
      {labelNode}
      {resolvedChildren}
      {hint ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
