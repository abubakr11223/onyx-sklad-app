"use client";

// Toast — событийная модель без провайдера/контекста: `toast(msg, variant)`
// диспатчит CustomEvent, а <Toaster> (в layout) его показывает. Так вызвать тост
// может ЛЮБОЙ клиентский компонент (формы, модалки, мост флеш-параметров), не
// прокидывая контекст через серверные границы. Авто-скрытие ~3.6с.
import { useEffect, useRef, useState } from "react";

export type ToastVariant = "success" | "danger" | "info";
type ToastItem = { id: number; msg: string; variant: ToastVariant; leaving?: boolean };

const EVENT = "onyx-toast";

/** Показать тост. Только на клиенте (использует window). */
export function toast(msg: string, variant: ToastVariant = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { msg, variant } }));
}

function Icon({ variant }: { variant: ToastVariant }) {
  if (variant === "success") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12l5 5L20 6" />
      </svg>
    );
  }
  if (variant === "danger") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </svg>
  );
}

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent).detail as { msg: string; variant: ToastVariant };
      const id = ++seq.current;
      setItems((xs) => [...xs, { id, msg: detail.msg, variant: detail.variant }]);
      // Пометить «уходящим» перед удалением (анимация выхода).
      window.setTimeout(() => {
        setItems((xs) => xs.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      }, 3300);
      window.setTimeout(() => {
        setItems((xs) => xs.filter((t) => t.id !== id));
      }, 3600);
    }
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="onyx-toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`onyx-toast onyx-toast-${t.variant}`} data-leaving={t.leaving ? "true" : undefined}>
          <Icon variant={t.variant} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
