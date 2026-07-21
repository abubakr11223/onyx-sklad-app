"use client";

// Верхняя навигация (десктоп). Мобиль использует BottomTabBar — здесь
// `hidden md:block`.
//
// ⚠️ R2 — навигация КОСМЕТИЧНА: скрывает ссылки, недоступные текущей роли.
// Реальная защита — гейты страниц + server-action'ов (сайт «kodsiz» открыт).
//
// Флик ссылок исправлен: раньше роль читалась cookie в useEffect (первый рендер
// шёл с DEFAULT_ROLE, ссылки мигали). Теперь capabilities приходят пропом с
// СЕРВЕРА (layout → getCapabilities), поэтому первый же рендер уже правильный —
// ни рассинхрона гидратации, ни мигания. usePathname оставляет "use client".

import Link from "next/link";
import { usePathname } from "next/navigation";
import DemoRoleSwitcher from "@/components/DemoRoleSwitcher";
import { logoutSession } from "@/app/login/actions";
import { visibleNavItems, type NavItem } from "@/components/nav-items";
import type { Capabilities } from "@/lib/permissions";

export default function Nav({
  caps,
  isLoggedIn = false,
}: {
  caps: Capabilities;
  isLoggedIn?: boolean;
}) {
  const pathname = usePathname();
  const links = visibleNavItems(caps);

  const isActive = (href: string) => href !== "/" && pathname?.startsWith(href);

  const linkClass = (active: boolean) =>
    [
      "inline-flex min-h-11 items-center gap-1.5 rounded-field px-3 text-sm transition",
      active
        ? "bg-gold/12 font-semibold text-gold-deep"
        : "text-ink/70 hover:bg-ink/5 hover:text-ink",
    ].join(" ");

  const inner = (item: NavItem, active: boolean) => (
    <>
      <item.Icon width={18} height={18} className={active ? "text-gold-deep" : ""} />
      {item.label}
    </>
  );

  return (
    <header className="sticky top-0 z-50 hidden border-b border-ink/10 bg-paper/85 backdrop-blur md:block">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5">
        <Link
          href="/"
          className="shrink-0 whitespace-nowrap font-serif text-lg font-bold tracking-wide text-ink"
        >
          On<span className="text-gold">y</span>x
          <span className="ml-1 font-sans text-sm font-normal text-ink/60">
            · склад
          </span>
        </Link>

        <nav aria-label="Основная навигация" className="flex-1 overflow-x-auto">
          <ul className="flex items-center gap-1 whitespace-nowrap">
            {links.map((item) => {
              const active = !!isActive(item.href);
              return (
                <li key={item.href}>
                  {item.external ? (
                    <a
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={linkClass(active)}
                    >
                      {inner(item, active)}
                    </a>
                  ) : (
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={linkClass(active)}
                    >
                      {inner(item, active)}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* R1: DEMO-переключатель роли (временно, убирается в R6). */}
        <DemoRoleSwitcher />

        {/* OWN-03: выход из реальной сессии (виден только при активном входе).
            Демо-роль остаётся — это разные механизмы. */}
        {isLoggedIn && (
          <form action={logoutSession} className="shrink-0">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-ink/60 ring-1 ring-ink/15 transition hover:text-ink hover:ring-ink/30"
            >
              Выйти
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
