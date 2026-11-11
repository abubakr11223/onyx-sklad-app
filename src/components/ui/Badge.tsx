// Onyx UI — Badge. Статус-метка. Не полагается ТОЛЬКО на цвет — рядом всегда
// текст (WCAG). warning=ЯНТАРНЫЙ теперь отделён от danger=красный (аудит).

import type { HTMLAttributes } from "react";

export type BadgeVariant = "success" | "warning" | "danger" | "neutral" | "info";

// ТЗ №20 §3.3/§7.4: пара «текст + тонированный фон» из «камневых» оттенков.
const VARIANTS: Record<BadgeVariant, string> = {
  success: "bg-malachite-bg text-malachite",
  warning: "bg-amber-bg text-amber",
  danger: "bg-carnelian-bg text-carnelian",
  info: "bg-slate-bg text-slate",
  neutral: "bg-neutral-bg text-neutral",
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
