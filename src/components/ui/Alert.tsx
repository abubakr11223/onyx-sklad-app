// Onyx UI — Alert. Единый flash-баннер ok/err (аудит: переизобретён ~10× по
// страницам). Один компонент, 4 тона. Не только цвет — иконка + заголовок текстом.
// success/warning ⇒ role="status"; danger ⇒ role="alert" (озвучивается сразу).

import type { ReactNode } from "react";
import { AlertTriangleIcon } from "./Icons";

export type AlertVariant = "success" | "danger" | "warning" | "info";

const TONE: Record<AlertVariant, { box: string; mark: ReactNode }> = {
  success: {
    box: "border-success/40 bg-success/10 text-success",
    mark: <CheckMark />,
  },
  danger: {
    box: "border-danger/40 bg-danger/10 text-danger",
    mark: <AlertTriangleIcon className="mt-0.5 shrink-0" />,
  },
  warning: {
    box: "border-warning/40 bg-warning/10 text-warning",
    mark: <AlertTriangleIcon className="mt-0.5 shrink-0" />,
  },
  info: {
    box: "border-ink/15 bg-ink/5 text-ink/80",
    mark: null,
  },
};

function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

type AlertProps = {
  variant?: AlertVariant;
  /** Жирная первая строка (напр. «Партия принята»). */
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export default function Alert({
  variant = "info",
  title,
  children,
  className = "",
}: AlertProps) {
  const tone = TONE[variant];
  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={[
        "flex gap-2.5 rounded-card border p-4 text-base",
        tone.box,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {tone.mark}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}
