// components/ui/Toast.tsx
import { useEffect } from "react";

export interface ToastProps {
  message?: string;
  type?: "success" | "error";
  visible: boolean;
  onClose?: () => void; // optional close handler
}

export function Toast({
  message,
  type = "success",
  visible,
  onClose,
}: ToastProps) {
  useEffect(() => {
    if (visible && onClose) {
      const timeout = setTimeout(() => {
        onClose();
      }, 2500); // Auto-dismiss after 2.5s
      return () => clearTimeout(timeout);
    }
  }, [visible, onClose]);

  if (!message) return null;

  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-sm rounded shadow-md p-4 text-sm transition-all duration-500 ease-in-out
        ${
          type === "success"
            ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-700"
        }
        ${
          visible
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-2 pointer-events-none"
        }
      `}
    >
      {type === "error" && message.trim() !== "" ? `❌ ${message}` : message}
    </div>
  );
}
