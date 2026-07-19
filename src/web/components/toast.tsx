import { useSyncExternalStore } from "react";

export type ToastTone = "success" | "error";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

let nextToastId = 1;
let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function removeToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emitChange();
}

export function pushToast({
  message,
  tone,
}: {
  message: string;
  tone: ToastTone;
}) {
  const id = nextToastId++;
  toasts = [...toasts, { id, message, tone }];
  emitChange();

  window.setTimeout(() => {
    removeToast(id);
  }, 2600);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return toasts;
}

export function ToastViewport() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (!items.length) {
    return null;
  }

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((toast) => (
        <div className={`toast ${toast.tone}`} key={toast.id}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
