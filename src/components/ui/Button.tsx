// Onyx UI — Button. Извлечён из копипаст-паттерна кнопок (аудит: дублировался
// в 5 файлах). Server-component-friendly (без "use client"): в клиентских формах
// принимает onClick, в серверных — работает как submit/ссылка-стиль.
//
// Мобиль-first: все интерактивные варианты ≥44px (min-h-11). Варианты:
//   primary   — графит (основное действие)
//   secondary — контур (второстепенное)
//   ghost     — без фона (третьестепенное)

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-field font-semibold " +
  "transition select-none disabled:opacity-50 disabled:pointer-events-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-2 active:bg-ink-2",
  secondary:
    "border border-ink/20 bg-transparent text-ink hover:border-gold hover:text-gold-deep",
  ghost: "bg-transparent text-ink hover:bg-ink/5",
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
