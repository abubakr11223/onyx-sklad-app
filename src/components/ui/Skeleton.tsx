// Onyx UI — скелетон загрузки (ТЗ №20 §7.7): плашка stone-100 по форме
// контента вместо крутящегося спиннера на весь экран. Без анимации.

export default function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={["onyx-skeleton", className].join(" ")} />;
}
