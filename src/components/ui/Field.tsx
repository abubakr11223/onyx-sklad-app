// Onyx UI — Field (label + input + error). Извлечён из копипаст-паттерна полей
// (аудит). Мобиль-first: input min-h-11 (44px), нативный контрол (слабая сеть —
// без JS-виджетов). Правильный inputMode прокидывается для числовых полей.
//
// Server-component-friendly. Основа для C2 (раскатка по формам).

import type { InputHTMLAttributes, ReactNode } from "react";

/** Классы нативного поля/селекта — держат стиль ввода в одном месте. */
export const inputClass =
  "min-h-11 w-full rounded-field border border-line bg-paper px-3 text-base " +
  "text-ink placeholder:text-ink/40 transition-[border-color,box-shadow] " +
  "focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30 " +
  "disabled:opacity-50 aria-[invalid=true]:border-danger";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  /** Текст ошибки — если задан, поле помечается aria-invalid. */
  error?: string;
  /** Подсказка под полем (когда ошибки нет). */
  hint?: string;
  /** Обёртка для собственного контрола (напр. <select>) вместо <input>. */
  children?: ReactNode;
};

export default function Field({
  label,
  error,
  hint,
  id,
  className = "",
  children,
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-sm font-semibold text-ink">
        {label}
      </label>

      {children ?? (
        <input
          id={controlId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[inputClass, className].filter(Boolean).join(" ")}
          {...inputProps}
        />
      )}

      {error ? (
        <p id={`${controlId}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${controlId}-hint`} className="text-sm text-ink/55">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
