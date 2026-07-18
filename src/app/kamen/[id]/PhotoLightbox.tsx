"use client";

// Галерея фото камня + лайтбокс. Миниатюры (сетка) — как раньше, через прокси
// /api/photo/[id]; клик по миниатюре открывает полноразмерное фото поверх
// страницы. Закрытие: Esc, клик по фону, кнопка «×». Ничего нового при монтаже
// не грузится — только уже переданные фото; полный размер запрашивает тот же
// прокси (без ?size=thumb) при открытии оверлея.
//
// Презентационный слой (BATCH-C): данные/логика «свежести» считаются на сервере
// и приходят готовыми (id/caption/stale) — здесь только показ и поведение.

import { useCallback, useEffect, useRef, useState } from "react";
import Badge from "@/components/ui/Badge";
import { AlertTriangleIcon } from "@/components/ui/Icons";

export interface LightboxPhoto {
  id: string;
  /** Уже отформатированная подпись «Снято …». */
  caption: string;
  /** TZ §5.3 — фото старше N месяцев: «возможно, переснять». */
  stale: boolean;
}

export default function PhotoLightbox({ photos }: { photos: LightboxPhoto[] }) {
  // Индекс открытого фото; null — оверлей закрыт.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Контейнер оверлея — для ловушки фокуса (Tab не уходит на страницу под ним).
  const dialogRef = useRef<HTMLDivElement>(null);
  // Куда вернуть фокус после закрытия (миниатюра, с которой открыли).
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpenIndex(null);
    // Возврат фокуса на миниатюру-триггер (доступность).
    lastTriggerRef.current?.focus();
  }, []);

  // Esc закрывает оверлей; Tab/Shift+Tab циклится ВНУТРИ диалога (ловушка
  // фокуса — не уходит на страницу под оверлеем). Слушатель — только когда открыт.
  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        close();
        return;
      }
      if (ev.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        ev.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (ev.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          ev.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        ev.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openIndex, close]);

  // При открытии — фокус на кнопку закрытия (клавиатурная навигация) и блокировка
  // прокрутки фона (body-scroll-lock); при закрытии/размонтаже — точный возврат
  // предыдущего значения overflow (без утечки).
  useEffect(() => {
    if (openIndex === null) return;
    closeButtonRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [openIndex]);

  const open = photos[openIndex ?? -1] ?? null;

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((p, i) => (
          <figure key={p.id} className="text-xs">
            <button
              type="button"
              onClick={(ev) => {
                lastTriggerRef.current = ev.currentTarget;
                setOpenIndex(i);
              }}
              className="block w-full overflow-hidden rounded-card border border-ink/10 transition
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold
                         focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              aria-label="Открыть фото во весь экран"
            >
              <img
                src={"/api/photo/" + p.id}
                className="aspect-square w-full object-cover"
                loading="lazy"
                alt="фото камня"
              />
            </button>
            <figcaption className="mt-1 text-ink/60">{p.caption}</figcaption>
            {p.stale && (
              <Badge variant="warning" className="mt-1">
                <AlertTriangleIcon width={12} height={12} />
                возможно, переснять
              </Badge>
            )}
          </figure>
        ))}
      </div>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр фото"
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-field
                       bg-paper/10 text-paper transition hover:bg-paper/20
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <svg
              viewBox="0 0 24 24"
              width={24}
              height={24}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>

          {/* Клик по самому фото не закрывает — стоп всплытия к фону. */}
          <figure
            onClick={(ev) => ev.stopPropagation()}
            className="flex max-h-full max-w-full flex-col items-center gap-3"
          >
            <img
              src={"/api/photo/" + open.id}
              alt="фото камня"
              className="max-h-[80vh] max-w-full rounded-card object-contain"
            />
            <figcaption className="text-sm text-paper/80">
              {open.caption}
              {open.stale && (
                <Badge variant="warning" className="ml-2 align-middle">
                  <AlertTriangleIcon width={12} height={12} />
                  возможно, переснять
                </Badge>
              )}
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
