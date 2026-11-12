// Onyx UI — пустое состояние (ТЗ №20 §7.8). Текст по центру области:
// заголовок 14px Medium + одна-две строки пояснения ink-2 + действие, если
// есть. Без иллюстраций. Тексты пустых состояний передаёт страница — дословно.

import type { ReactNode } from "react";

export default function EmptyState({
  title,
  children,
  action,
  className = "",
  bare = false,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Без рамки — когда область уже внутри карточки/таблицы. */
  bare?: boolean;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center px-4 py-8 text-center",
        bare ? "" : "rounded-card border border-line bg-marble",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
