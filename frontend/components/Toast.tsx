"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import * as React from "react";

/**
 * Toast system.
 *
 * This is the one piece of UI Phase 1 adds rather than migrates: /client's
 * writes reached a real backend, so a failed action produced a real error
 * and a successful one produced a real navigation. Here most writes are
 * mocked, and an action that appears to do nothing is worse than one that
 * says what it did — so every mocked mutation reports itself, and says
 * plainly that it is running in demo mode.
 *
 * It is built from the same design tokens as everything else
 * (packages/ui/tokens.css) rather than pulling in a toast library: the
 * severity colours are `success` / `warning` / `danger` / `info`, the radius
 * and shadow are the shell's, and it inherits light/dark with the page.
 */

export type ToastTone = "success" | "info" | "warning" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before it dismisses itself; 0 keeps it until dismissed. */
  durationMs?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, "description">> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
  /**
   * The demo-mode shorthand. Everything that would have written to the
   * backend calls this, so the wording stays consistent across ~40 screens
   * and is trivially greppable when the real APIs arrive.
   */
  demoToast: (title: string, description?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

const TONE_STYLES: Record<ToastTone, { className: string; Icon: typeof Info }> = {
  success: { className: "border-success-border bg-success-subtle text-success", Icon: CheckCircle2 },
  info: { className: "border-info-border bg-info-subtle text-info", Icon: Info },
  warning: { className: "border-warning-border bg-warning-subtle text-warning", Icon: AlertTriangle },
  error: { className: "border-danger-border bg-danger-subtle text-danger", Icon: XCircle },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, tone = "success", durationMs = 5000 }: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, title, description, tone, durationMs }]);
      if (durationMs > 0) {
        window.setTimeout(() => {
          setToasts((current) => current.filter((row) => row.id !== id));
        }, durationMs);
      }
    },
    [],
  );

  const demoToast = React.useCallback(
    (title: string, description?: string) => {
      toast({
        title,
        description: description ?? "Running in demo mode — backend integration pending.",
        tone: "info",
      });
    },
    [toast],
  );

  const value = React.useMemo(() => ({ toast, demoToast, dismiss }), [toast, demoToast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // `aria-live` rather than `role="alert"` per toast: a queue that
        // interrupts on every item is worse for a screen-reader user than one
        // that announces politely in order (docs/05 §9).
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((row) => {
          const { className, Icon } = TONE_STYLES[row.tone];
          return (
            <div
              key={row.id}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-md border px-3.5 py-3 shadow-md ${className}`}
            >
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold">{row.title}</p>
                {row.description ? (
                  <p className="mt-0.5 text-[12px] opacity-90">{row.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(row.id)}
                aria-label="Dismiss"
                className="rounded-sm p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                <X aria-hidden className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
