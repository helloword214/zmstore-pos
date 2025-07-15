// app/components/ui/Button.tsx

import { clsx } from "clsx";
import { theme } from "~/lib/theme";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "accent" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

export function Button({
  variant = "primary",
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button className={clsx(theme.buttons[variant], className)} {...props}>
      {children}
    </button>
  );
}
