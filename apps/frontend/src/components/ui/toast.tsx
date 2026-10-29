import React, { useState, useEffect, useCallback } from "react";
import { X, Bell, CheckCircle2, AlertCircle } from "lucide-react";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
  duration?: number;
}

export interface ToastItem extends ToastOptions {
  id: string;
}

type ToastListener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();

function notify() {
  listeners.forEach(fn => fn([...toasts]));
}

export function toast(options: ToastOptions): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item: ToastItem = {
    ...options,
    id,
    duration: options.duration ?? 5000
  };

  toasts = [item, ...toasts.slice(0, 4)]; // Max 5 toasts visible
  notify();

  if (item.duration && item.duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, item.duration);
  }

  return id;
}

export function dismissToast(id: string) {
  const prevLen = toasts.length;
  toasts = toasts.filter(t => t.id !== id);
  if (toasts.length !== prevLen) {
    notify();
  }
}

export function clearToasts() {
  toasts = [];
  notify();
}

export function useToast() {
  const [activeToasts, setActiveToasts] = useState<ToastItem[]>(toasts);

  useEffect(() => {
    const handleUpdate = (updated: ToastItem[]) => {
      setActiveToasts(updated);
    };
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, []);

  return {
    toasts: activeToasts,
    toast,
    dismissToast
  };
}

export function ToastContainer() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="toast-container"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2.5 pointer-events-none"
    >
      {toasts.map(t => (
        <div
          key={t.id}
          data-testid="toast-item"
          className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-3.5 text-card-foreground shadow-lg transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
          role="status"
        >
          <div className="mt-0.5 shrink-0 text-primary">
            {t.variant === "destructive" ? (
              <AlertCircle className="h-4 w-4 text-destructive" />
            ) : t.variant === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <Bell className="h-4 w-4 text-primary" />
            )}
          </div>
          <div className="flex-1 space-y-1 pr-1 min-w-0">
            <div className="text-xs font-semibold leading-tight text-foreground truncate">
              {t.title}
            </div>
            {t.description && (
              <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {t.description}
              </div>
            )}
          </div>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
