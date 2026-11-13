// Глобальный скелет загрузки (App Router оборачивает страницу в Suspense).
// Все страницы force-dynamic с тяжёлыми запросами — без скелета переход даёт
// пустой экран (аудит: причина «тормозит» №1). Nav/таб-бар живут в layout и
// остаются на месте; здесь — только область контента.
// ТЗ №20 §7.7: плашки stone-100 по форме контента, без анимации.

import Skeleton from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Загрузка"
      className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8"
    >
      <div className="mb-8">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-card border border-line bg-marble p-5"
          >
            <Skeleton className="size-11 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="mt-2 h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
