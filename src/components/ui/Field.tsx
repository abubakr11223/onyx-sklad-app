// Onyx UI — Field (label + input + error). Извлечён из копипаст-паттерна полей
// (аудит). Мобиль-first: input min-h-11 (44px), нативный контрол (слабая сеть —
// без JS-виджетов). Правильный inputMode прокидывается для числовых полей.
//
// Server-component-friendly. Основа для C2 (раскатка по формам).

import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * Классы нативного поля/селекта — держат стиль ввода в одном месте.
 * ТЗ №20 §7.2: 36px на десктопе (44px на телефоне — палец), marble, рамка
 * line-strong, радиус 6px; фокус — рамка honey + кольцо 3px honey-soft;
 * ошибка — рамка carnelian. 16px шрифт на телефоне — iOS не зумит поле.
 */
export const inputClass =
  "min-h-11 md:min-h-9 w-full rounded-field border border-line-strong bg-marble px-3 " +
  "text-base md:text-sm text-ink placeholder:text-ink-3 " +
  "transition-[border-color,box-shadow] duration-150 " +
  "focus:border-honey focus:outline-none focus:ring-[3px] focus:ring-honey-soft " +
  "disabled:cursor-not-allowed disabled:opacity-40 " +
  "aria-[invalid=true]:border-carnelian";

/** Подпись над полем: 12px, ink-2 (ТЗ №20 §7.2). */
export const labelClass = "text-xs font-medium text-ink-2";
/** Звёздочка обязательного поля после подписи (carnelian). */
export const requiredMark = "after:ml-0.5 after:text-carnelian after:content-['*']";
/** Подсказка под полем: 12px, ink-2. */
export const hintClass = "text-xs text-ink-2";
/** Ошибка под полем: 12px, carnelian. */
export const errorClass = "text-xs font-medium text-carnelian";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  /** Текст ошибки — если задан, поле помечается aria-invalid. */
  error?: string;
  /** Подсказка под полем (когда ошибки нет). */
  hint?: string;
  /** Обёртка для собственного контрола (напр. <select>) вместо <input>. */
  children?: ReactNode;
  /** Единица измерения суффиксом внутри поля справа: «см», «м²», «плит». */
  suffix?: ReactNode;
};

export default function Field({
  label,
  error,
  hint,
  id,
  className = "",
  children,
  suffix,
  ...inputProps
}: FieldProps) {
  const controlId =
    id ?? (typeof label === "string" ? label : undefined);
  const describedBy = error
    ? `${controlId}-error`
    : hint
      ? `${controlId}-hint`
      : undefined;

  return (
    <div className="flex flex-col gap-1">
      {/* Обязательность — звёздочка carnelian после подписи (CSS-псевдоэлемент:
          не попадает в текст подписи и в её доступное имя). */}
      <label
        htmlFor={controlId}
        className={[labelClass, inputProps.required ? requiredMark : ""].filter(Boolean).join(" ")}
      >
        {label}
        {/* Единица видна суффиксом в поле; в подписи — только для
            скринридера (доступное имя «Длина, см» сохраняется). */}
        {typeof suffix === "string" && <span className="sr-only">, {suffix}</span>}
      </label>

      {children ?? (
        <div className={suffix ? "relative" : "contents"}>
          <input
            id={controlId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={[inputClass, suffix ? "pr-12" : "", className]
              .filter(Boolean)
              .join(" ")}
            {...inputProps}
          />
          {suffix && (
            <span
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-3"
              aria-hidden="true"
            >
              {suffix}
            </span>
          )}
        </div>
      )}

      {error ? (
        <p id={`${controlId}-error`} className={errorClass}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${controlId}-hint`} className={hintClass}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
