// Onyx UI — список результатов выпадающего поиска (ТЗ №20 §7.2): блок,
// клиент, партия — один общий вид. Строки 36px (44px на телефоне), совпадение
// с запросом — полужирным. Сам поиск (запрос к серверу, задержка) остаётся у
// формы — компонент только рисует результаты.

import type { ReactNode } from "react";

/** Подсветка совпадения: часть `text`, совпавшая с `query`, — полужирная. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLocaleLowerCase("ru").indexOf(q.toLocaleLowerCase("ru"));
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold text-ink">{text.slice(i, i + q.length)}</strong>
      {text.slice(i + q.length)}
    </>
  );
}

export type SearchResultItem = {
  key: string;
  onSelect: () => void;
  content: ReactNode;
};

export default function SearchResults({
  items,
  className = "",
}: {
  items: SearchResultItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      className={[
        "max-h-72 overflow-y-auto rounded-field border border-line bg-marble py-1",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            onClick={it.onSelect}
            className="flex min-h-11 w-full items-center gap-1 px-3 text-left text-sm text-ink transition-colors duration-150 hover:bg-stone-100 focus-visible:bg-stone-100 focus-visible:outline-none md:min-h-9"
          >
            {it.content}
          </button>
        </li>
      ))}
    </ul>
  );
}
