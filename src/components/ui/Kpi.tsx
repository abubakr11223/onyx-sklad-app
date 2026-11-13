// Onyx UI — итог-KPI (ТЗ №20 §7.5): подпись 12px ink-2 сверху, цифра 28px
// Medium, вторая валюта — отдельной строкой 14px. Валюты не складываются:
// строку formatCurrencySummaryLine («… сум  ·  $ …») компонент лишь режет по
// разделителю «  ·  ». Без мини-графиков и «±%».

import type { ReactNode } from "react";

export default function Kpi({
  label,
  line,
  danger = false,
  hint,
  className = "",
}: {
  label: ReactNode;
  /** Число или строка-сводка по валютам; null → «—». */
  line: string | number | null | undefined;
  /** Сердолик — долги, просрочка. */
  danger?: boolean;
  /** Необязательная строка-пояснение под цифрой (12px ink-2). */
  hint?: ReactNode;
  className?: string;
}) {
  const parts = line == null || line === "" ? [] : String(line).split("  ·  ");
  const tone = danger && parts.length > 0 ? "text-carnelian" : "text-ink";
  return (
    <div className={["rounded-card border border-line bg-marble p-4", className].filter(Boolean).join(" ")}>
      <p className="text-xs font-medium text-ink-2">{label}</p>
      {parts.length === 0 ? (
        <p className="mt-1 text-[28px] font-medium leading-9 text-ink-3">—</p>
      ) : (
        parts.map((p, i) => (
          <p
            key={i}
            className={
              i === 0
                ? `tnum mt-1 text-[28px] font-medium leading-9 ${tone}`
                : `tnum text-sm ${tone}`
            }
          >
            {p}
          </p>
        ))
      )}
      {hint && <p className="mt-1 text-xs text-ink-2">{hint}</p>}
    </div>
  );
}
