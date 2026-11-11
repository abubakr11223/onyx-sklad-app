// Onyx UI — Button. Извлечён из копипаст-паттерна кнопок (аудит: дублировался
// в 5 файлах). Server-component-friendly (без "use client"): в клиентских формах
// принимает onClick, в серверных — работает как submit/ссылка-стиль.
//
// Мобиль-first: все интерактивные варианты ≥44px (min-h-11). Варианты:
//   primary   — графит (основное действие)
//   secondary — контур (второстепенное)
//   ghost     — без фона (третьестепенное)
//   danger    — красный (деструктивное действие)

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const BASE =
  "onyx-btn inline-flex items-center justify-center gap-2 rounded-field font-semibold " +
  "transition-[transform,box-shadow,background-color,border-color,color] duration-150 " +
  "ease-out select-none will-change-transform active:translate-y-0 active:scale-[.99] " +
  "disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none disabled:translate-y-0 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

// Единый стиль на всё приложение (тема «Графит»): сплошной синий = основное,
// светлая панель+контур = второстепенное, «призрак» = третьестепенное,
// красный контур = деструктивное (красным не кричим — лишь контур).
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "text-on-gold bg-gold shadow-gold hover:bg-gold-deep",
  secondary:
    "border border-line bg-paper-2 text-ink " +
    "hover:border-ink/25 hover:bg-paper",
  ghost: "bg-transparent text-ink/70 hover:bg-ink/5 hover:text-ink",
  danger:
    "border border-danger/35 bg-transparent text-danger " +
    "hover:-translate-y-px hover:border-danger hover:bg-danger/8",
};

// min-h-11 = 44px — минимальная зона касания (мобиль-first).
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-base",
  sm: "min-h-11 px-3 text-sm",
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
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      {...props}
    />
  );
}
