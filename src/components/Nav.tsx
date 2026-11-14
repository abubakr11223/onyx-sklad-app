"use client";

// Боковое меню (десктоп). Мобиль использует BottomTabBar — здесь
// `hidden md:flex`. Тема «Оникс» (ТЗ №20 §6.1): фон onyx-950, 240px,
// сворачивается до 64px (только иконки, подпись — в тултипе; состояние
// запоминается в localStorage и ставится скриптом в layout.tsx ДО отрисовки).
// Пункты сгруппированы (Склад / Продажи / Справочники / Контроль).
//
// ⚠️ R2 — навигация КОСМЕТИЧНА: скрывает ссылки, недоступные текущей роли.
// Реальная защита — login-gate (middleware) + гейты страниц/server-action'ов.
//
// Capabilities приходят пропом с СЕРВЕРА (layout → getCapabilities): первый же
// рендер правильный — ни рассинхрона гидратации, ни мигания ссылок. usePathname
// оставляет "use client".

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutSession } from "@/app/login/actions";
import { groupedNavItems, type NavItem } from "@/components/nav-items";
import { roleLabel } from "@/lib/role-labels";
import type { Capabilities, Role } from "@/lib/permissions";

const NAV_KEY = "onyx-nav";

function toggleCollapsed() {
  const root = document.documentElement;
  const collapsed = root.dataset.nav !== "collapsed";
  if (collapsed) root.dataset.nav = "collapsed";
  else delete root.dataset.nav;
  try {
    localStorage.setItem(NAV_KEY, collapsed ? "collapsed" : "open");
  } catch {
    // приватный режим — просто не запоминаем
  }
}

export default function Nav({
  caps,
  user = null,
}: {
  caps: Capabilities;
  user?: { name: string; role: Role } | null;
}) {
  const pathname = usePathname();
  const groups = groupedNavItems(caps);

  const isActive = (href: string) => href !== "/" && !!pathname?.startsWith(href);

  // Пункт: 36px, иконка 18 + текст 14, цвет side-text. Hover — onyx-900,
  // активный — onyx-800 + полоса мёда 3px слева (inset-тень: не съезжает).
  const linkClass = (active: boolean) =>
    [
      "flex h-9 items-center gap-3 px-5 text-sm transition-colors duration-150",
      "nav-collapsed:justify-center nav-collapsed:px-0",
      active
        ? "bg-onyx-800 font-medium text-white shadow-[inset_3px_0_0_var(--color-honey)]"
        : "text-side-text hover:bg-onyx-900 hover:text-white",
    ].join(" ");

  const item = (it: NavItem) => {
    const active = isActive(it.href);
    const inner = (
      <>
        <it.Icon width={18} height={18} strokeWidth={1.5} className="shrink-0" />
        <span className="truncate nav-collapsed:sr-only">{it.label}</span>
      </>
    );
    const common = {
      href: it.href,
      title: it.label,
      "aria-current": active ? ("page" as const) : undefined,
      className: linkClass(active),
    };
    return (
      <li key={it.href}>
        {it.external ? <a {...common}>{inner}</a> : <Link {...common}>{inner}</Link>}
      </li>
    );
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 flex-col bg-onyx-950 text-side-text md:flex nav-collapsed:w-16">
      {/* Логотип + роль */}
      <Link
        href="/"
        title="Onyx — главная"
        className="block px-5 pb-5 pt-6 nav-collapsed:px-0 nav-collapsed:text-center"
      >
        <span className="block text-2xl font-semibold leading-6 tracking-[0.08em] text-white">
          <span className="nav-collapsed:hidden">ONYX</span>
          <span className="hidden nav-collapsed:inline">O</span>
        </span>
        {user && (
          <span className="mt-1 block text-xs text-side-text nav-collapsed:hidden">
            {roleLabel(user.role)}
          </span>
        )}
      </Link>

      {/* Навигация по группам */}
      <nav aria-label="Основная навигация" className="flex-1 overflow-y-auto pb-2">
        {groups.map((g, i) => (
          <div key={g.title} className={i === 0 ? "" : "mt-4"}>
            <p className="px-5 pb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-side-muted nav-collapsed:sr-only">
              {g.title}
            </p>
            <ul>{g.items.map(item)}</ul>
          </div>
        ))}
      </nav>

      {/* Подвал: имя пользователя, «Выйти», свернуть меню. */}
      <div className="border-t border-onyx-800 px-3 py-3">
        {user ? (
          <div className="flex items-center gap-2 nav-collapsed:flex-col">
            <span
              className="min-w-0 flex-1 truncate px-2 text-sm text-white nav-collapsed:sr-only"
              title={user.name}
            >
              {user.name}
            </span>
            <form action={logoutSession}>
              <button
                type="submit"
                title="Выйти"
                className="flex h-9 items-center gap-2 rounded-field px-2 text-sm text-side-text transition-colors duration-150 hover:bg-onyx-900 hover:text-white"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                <span className="nav-collapsed:sr-only">Выйти</span>
              </button>
            </form>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex h-9 items-center justify-center rounded-field text-sm text-side-text transition-colors duration-150 hover:bg-onyx-900 hover:text-white"
          >
            Войти
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Свернуть / развернуть меню"
          aria-label="Свернуть или развернуть меню"
          className="mt-1 flex h-9 w-full items-center gap-2 rounded-field px-2 text-sm text-side-muted transition-colors duration-150 hover:bg-onyx-900 hover:text-white nav-collapsed:justify-center"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="nav-collapsed:rotate-180">
            <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
          </svg>
          <span className="nav-collapsed:sr-only">Свернуть меню</span>
        </button>
      </div>
    </aside>
  );
}
