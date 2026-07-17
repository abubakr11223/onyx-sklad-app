// Глобальный скелет загрузки (App Router оборачивает страницу в Suspense).
// Все страницы force-dynamic с тяжёлыми запросами — без скелета переход даёт
// пустой экран (аудит: причина «тормозит» №1). Nav/таб-бар живут в layout и
// остаются на месте; здесь — только область контента.

export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Загрузка"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12"
    >
      <div className="mb-8">
        <div className="h-3 w-28 animate-pulse rounded bg-ink/10" />
        <div className="mt-3 h-9 w-72 max-w-full animate-pulse rounded bg-ink/10" />
        <div className="mt-3 h-5 w-96 max-w-full animate-pulse rounded bg-ink/10" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-card border border-ink/10 bg-paper-2/50 p-5"
          >
            <div className="size-11 shrink-0 animate-pulse rounded-field bg-ink/10" />
            <div className="min-w-0 flex-1">
              <div className="h-5 w-24 animate-pulse rounded bg-ink/10" />
              <div className="mt-2 h-4 w-full animate-pulse rounded bg-ink/10" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
