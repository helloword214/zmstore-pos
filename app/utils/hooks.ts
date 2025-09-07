// app/lib/hooks.ts
import * as React from "react";

export function useLocalStorageState<T>(key: string, initial: T) {
  const get = React.useCallback((): T => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  }, [key, initial]);

  const [state, setState] = React.useState<T>(get);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);

  return [state, setState] as const;
}
