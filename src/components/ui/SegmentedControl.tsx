"use client";

// Onyx UI — сегмент-контрол (ТЗ №20 §7.2): переключатель режимов
// («Плита / Бой в партии», «Из партии / Готовая плита / Бой»). Фон stone-100,
// выбранный сегмент — marble с рамкой line. Пояснение режима — строкой под
// ним (передаётся через `hint`).

import type { ReactNode } from "react";

export type SegmentOption<T extends string> = { value: T; label: ReactNode };

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  hint,
  className = "",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Подпись для скринридера (визуально не показывается). */
  label: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-1 rounded-field bg-stone-100 p-1"
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={[
                "min-h-10 flex-1 rounded-[0.3125rem] border px-3 text-sm font-medium transition-colors duration-150 md:min-h-8",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-honey-soft",
                on
                  ? "border-line bg-marble text-ink"
                  : "border-transparent text-ink-2 hover:text-ink",
              ].join(" ")}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hint && <p className="mt-1.5 text-xs text-ink-2">{hint}</p>}
    </div>
  );
}
