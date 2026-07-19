import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const AUTO_DISMISS_MS = 2500;

type ToastAction = { label: string; onClick: () => void };

type ToastOptions = { persistent?: boolean; action?: ToastAction };

type Toast = {
  id: number;
  message: string;
  action?: ToastAction;
  dismissible: boolean;
};

export type ToastHandle = {
  id: number;
  update: (message: string) => void;
  dismiss: () => void;
};

type ToastContextValue = {
  show: (message: string, options?: ToastOptions) => ToastHandle;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const NOOP_HANDLE: ToastHandle = {
  id: -1,
  update: () => {},
  dismiss: () => {},
};

const NOOP: ToastContextValue = { show: () => NOOP_HANDLE };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions): ToastHandle => {
      nextId.current += 1;
      const id = nextId.current;
      const persistent = options?.persistent ?? false;
      setToasts((current) => [
        ...current,
        { id, message, action: options?.action, dismissible: persistent },
      ]);
      if (!persistent) {
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      }
      return {
        id,
        update: (next) =>
          setToasts((current) =>
            current.map((t) => (t.id === id ? { ...t, message: next } : t)),
          ),
        dismiss: () => dismiss(id),
      };
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={toast.action.onClick}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {toast.action.label}
              </button>
            )}
            {toast.dismissible && (
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(toast.id)}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP;
}
