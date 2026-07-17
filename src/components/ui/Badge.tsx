// Onyx UI — Badge. Статус-метка. Не полагается ТОЛЬКО на цвет — рядом всегда
// текст (WCAG). warning=ЯНТАРНЫЙ теперь отделён от danger=красный (аудит).

import type { HTMLAttributes } from "react";

export type BadgeVariant = "success" | "warning" | "danger" | "neutral";

const VARIANTS: Record<BadgeVariant, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  neutral: "bg-ink/8 text-ink/70",
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
        "inline-flex items-center gap-1 rounded-field px-2 py-0.5 text-xs font-semibold",
        VARIANTS[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
