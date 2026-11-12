"use client";

// Modal — доступный диалог: затемнение + всплывающая карточка. Esc и клик по
// фону закрывают; фокус уходит внутрь; body-скролл блокируется на время показа.
// Композиционный: любой контент внутрь (заголовок/текст/кнопки задаёт вызывающий).
import { useEffect, useRef } from "react";

export default function Modal({
  open,
  onClose,
  title,
  children,
  labelledById = "onyx-modal-title",
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  labelledById?: string;
  /** Ширина: md = 480px, lg = 640px (ТЗ №20 §7.7). */
  size?: "md" | "lg";
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Фокус внутрь диалога (первая кнопка/поле или сама карточка).
    const focusable = cardRef.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    (focusable ?? cardRef.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="onyx-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={size === "lg" ? "onyx-modal onyx-modal-lg" : "onyx-modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelledById : undefined}
        tabIndex={-1}
      >
        {title && (
          <h3 id={labelledById} className="mb-2 text-base font-semibold text-ink">
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}
