// Onyx UI — Alert. Единый flash-баннер ok/err (аудит: переизобретён ~10× по
// страницам). Один компонент, 4 тона. Не только цвет — иконка + заголовок текстом.
// success/warning ⇒ role="status"; danger ⇒ role="alert" (озвучивается сразу).

import type { ReactNode } from "react";
import { AlertTriangleIcon } from "./Icons";

export type AlertVariant = "success" | "danger" | "warning" | "info";

const TONE: Record<AlertVariant, { box: string; mark: ReactNode }> = {
  success: {
    box: "border-malachite/25 bg-malachite-bg text-malachite",
    mark: <CheckMark />,
  },
  danger: {
    box: "border-carnelian-line bg-carnelian-bg text-carnelian",
    mark: <AlertTriangleIcon className="mt-0.5 shrink-0" />,
  },
  warning: {
    box: "border-amber/25 bg-amber-bg text-amber",
    mark: <AlertTriangleIcon className="mt-0.5 shrink-0" />,
  },
  info: {
    box: "border-line bg-stone-100 text-ink",
    mark: null,
  },
};

function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
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
        "flex gap-2.5 rounded-card border px-4 py-3 text-sm",
        tone.box,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {tone.mark}
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}
