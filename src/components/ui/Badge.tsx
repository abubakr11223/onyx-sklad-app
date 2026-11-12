// Onyx UI — Badge. Статус-метка. Не полагается ТОЛЬКО на цвет — рядом всегда
// текст (WCAG). warning=ЯНТАРНЫЙ теперь отделён от danger=красный (аудит).

import type { HTMLAttributes } from "react";

export type BadgeVariant =
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "info"
  // Тип задачи (Отгрузки) — рамка вместо заливки, чтобы не путать со статусом.
  | "type-sale"
  | "type-sample"
  | "type-showroom";

// ТЗ №20 §3.3/§7.4: пара «текст + тонированный фон» из «камневых» оттенков.
const VARIANTS: Record<BadgeVariant, string> = {
  success: "bg-malachite-bg text-malachite",
  warning: "bg-amber-bg text-amber",
  danger: "bg-carnelian-bg text-carnelian",
  info: "bg-slate-bg text-slate",
  neutral: "bg-neutral-bg text-neutral",
  "type-sale": "border border-ink text-ink",
  "type-sample": "border border-slate text-slate",
  "type-showroom": "border border-honey-ink text-honey-ink",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export default function Badge({
  variant = "neutral",
  className = "",
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-badge px-2 text-xs font-medium",
        VARIANTS[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
