// Главная — роль-фильтрованные разделы (аудит: MANAGER видел «Приёмку» и
// упирался в «Нет доступа»). Тот же капабилити-фильтр, что и у навигации.
// Тяжёлые запросы НЕ грузим (дашборд-счётчики отложены в C2 как рискованные).

import Link from "next/link";
import { getCapabilities } from "@/lib/session";
import { visibleNavItems, type NavItem } from "@/components/nav-items";
import DemoRoleSwitcher from "@/components/DemoRoleSwitcher";

export const dynamic = "force-dynamic";

export default async function Home() {
  const caps = await getCapabilities();
  const sections = visibleNavItems(caps);

  const cardClass =
    "group flex items-start gap-3 rounded-card border border-ink/10 bg-paper-2/50 p-5 " +
    "transition hover:border-gold hover:bg-paper-2 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

  const inner = (section: NavItem) => (
    <>
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-field bg-gold/12 text-gold-deep transition group-hover:bg-gold group-hover:text-ink"
      >
        <section.Icon width={22} height={22} />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold text-ink">
          {section.label}
        </span>
        <span className="mt-1 block text-sm text-ink/60">
          {section.description}
        </span>
      </span>
    </>
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink sm:text-4xl">
          Складская система
        </h1>
        <p className="mt-2 text-lg text-ink/60">
          Учёт натурального камня: партии, плиты, остатки, брони.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) =>
          section.external ? (
            <a key={section.href} href={section.href} className={cardClass}>
              {inner(section)}
            </a>
          ) : (
            <Link key={section.href} href={section.href} className={cardClass}>
              {inner(section)}
            </Link>
          ),
        )}
      </div>

      {/* DEMO-переключатель роли доступен и на мобиле (в топ-навигации он скрыт
          под md). Приглушён — временный демо-контроль (убирается в R6). */}
      <footer className="mt-12 flex justify-center md:hidden">
        <DemoRoleSwitcher />
      </footer>
    </main>
  );
}
