// Onyx UI — Button. Извлечён из копипаст-паттерна кнопок (аудит: дублировался
// в 5 файлах). Server-component-friendly (без "use client"): в клиентских формах
// принимает onClick, в серверных — работает как submit/ссылка-стиль.
//
// Касание: 44px на телефоне, 36px на десктопе (ТЗ №20 §5). Варианты:
//   primary   — чёрная (одно главное действие экрана)
//   secondary — мрамор + рамка (второстепенное)
//   ghost     — текстовая ссылка honey-ink (действия в строках)
//   danger    — сердолик контуром (деструктивное)

import type { ButtonHTMLAttributes } from "react";

/** Спиннер 14px внутри кнопки во время отправки (ТЗ №20 §7.1). */
export function ButtonSpinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0 animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-field font-medium " +
  "transition-[background-color,border-color,color] duration-150 ease-out select-none " +
  "disabled:opacity-40 disabled:cursor-not-allowed " +
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-honey-soft " +
  "focus-visible:border-honey";

// Тема «Оникс» (ТЗ №20 §7.1): основная — ЧЁРНАЯ (ink, hover onyx-800);
// мёд на кнопках запрещён (белый на мёде не проходит контраст). Вторичная —
// мрамор + рамка line-strong; текстовая — ссылка honey-ink; опасная — мрамор
// + сердолик, всегда с подтверждением (как сейчас).
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-ink bg-ink text-white hover:border-onyx-800 hover:bg-onyx-800",
  secondary:
    "border border-line-strong bg-marble text-ink hover:bg-stone-100",
  ghost: "border border-transparent bg-transparent text-honey-ink hover:underline underline-offset-4",
  danger:
    "border border-carnelian-line bg-marble text-carnelian hover:bg-carnelian-bg",
};

// 36px на десктопе, 44px на телефоне (касание пальцем).
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 md:min-h-9 px-4 text-sm",
  sm: "min-h-11 md:min-h-9 px-3 text-sm",
};

/**
 * Классы кнопки для случаев, когда сам элемент — не <button>
 * (напр. <Link>/<a> как кнопка). Держит стиль в одном месте.
 */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return [BASE, VARIANTS[variant], SIZES[size], extra].filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Идёт отправка: спиннер 14px + кнопка заблокирована (двойной тап). */
  pending?: boolean;
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  pending = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && <ButtonSpinner />}
      {children}
    </button>
  );
}
