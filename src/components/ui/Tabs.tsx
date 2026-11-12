// Onyx UI — вкладки-ссылки (ТЗ №20 §7.6). Текст 14px Medium; неактивная —
// ink-2, активная — ink + подчёркивание мёдом 2px; число — ink-3
// («К отгрузке 12»); общая линия line под всеми вкладками.
//
// Вкладки = ссылки: фильтр остаётся в URL (как было). Server-friendly.

import Link from "next/link";

export type TabItem = {
  href: string;
  label: string;
  active: boolean;
  /** Необязательное число рядом с подписью. */
  count?: number | null;
};

export default function Tabs({
  items,
  className = "",
  label = "Вкладки",
  underline = true,
}: {
  items: TabItem[];
  className?: string;
  label?: string;
  /** false — общую линию рисует родитель (вкладки + ссылка в одной строке). */
  underline?: boolean;
}) {
  return (
    <nav
      aria-label={label}
      className={["flex gap-6 overflow-x-auto", underline ? "border-b border-line" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={[
            "-mb-px flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-sm font-medium transition-colors duration-150 md:min-h-10",
            t.active
              ? "border-honey text-ink"
              : "border-transparent text-ink-2 hover:text-ink",
          ].join(" ")}
        >
          {t.label}
          {t.count != null && <span className="tnum text-ink-3">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
