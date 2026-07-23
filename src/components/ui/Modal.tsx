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
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  labelledById?: string;
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
        className="onyx-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelledById : undefined}
        tabIndex={-1}
      >
        {title && (
          <h3 id={labelledById} className="mb-1.5 text-lg font-bold tracking-tight text-ink">
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}
