import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const DURATION_MS = 5000;

const toneClasses: Record<ToastTone, string> = {
  info: 'bg-slate-900 text-white',
  success: 'bg-emerald-700 text-white',
  error: 'bg-red-700 text-white',
};
const toneIcons: Record<ToastTone, string> = { info: 'ℹ', success: '✓', error: '!' };

/** Notifications éphémères, lues par les lecteurs d'écran (aria-live). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      // Le même message deux fois de suite (double clic) : un seul toast.
      setToasts((list) => [...list.filter((t) => t.message !== message), { id, message, tone }]);
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg px-4 py-3 shadow-lg ${toneClasses[toast.tone]}`}
          >
            <span aria-hidden="true" className="font-bold">
              {toneIcons[toast.tone]}
            </span>
            <p className="flex-1 text-sm">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="-my-1 rounded px-2 py-1 text-sm opacity-80 hover:opacity-100"
              aria-label="Fermer la notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast doit être utilisé dans <ToastProvider>');
  return api;
}
