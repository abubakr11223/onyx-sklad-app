"use client";

// Боковая панель (десктоп). Мобиль использует BottomTabBar — здесь
// `hidden md:flex`. Утв. единый макет 2026-07-22: тёмная панель, золотая
// метка активного раздела, две группы (Работа / Управление).
//
// ⚠️ R2 — навигация КОСМЕТИЧНА: скрывает ссылки, недоступные текущей роли.
// Реальная защита — гейты страниц + server-action'ов (сайт «kodsiz» открыт).
//
// Capabilities приходят пропом с СЕРВЕРА (layout → getCapabilities): первый же
// рендер правильный — ни рассинхрона гидратации, ни мигания ссылок. usePathname
// оставляет "use client".

import Link from "next/link";
import { usePathname } from "next/navigation";
import DemoRoleSwitcher from "@/components/DemoRoleSwitcher";
import { logoutSession } from "@/app/login/actions";
import { visibleNavItems, type NavItem } from "@/components/nav-items";
import type { Capabilities } from "@/lib/permissions";

// Раздел «Работа» (ежедневные операции) vs «Управление» (обзор/настройки).
const WORK = new Set(["/poisk", "/priemka", "/bron", "/prodazha", "/razbit"]);

export default function Nav({
  caps,
  isLoggedIn = false,
}: {
  caps: Capabilities;
  isLoggedIn?: boolean;
}) {
  const pathname = usePathname();
  const links = visibleNavItems(caps);
  const work = links.filter((l) => WORK.has(l.href));
  const manage = links.filter((l) => !WORK.has(l.href));

  const isActive = (href: string) => href !== "/" && pathname?.startsWith(href);

  const linkClass = (active: boolean) =>
    [
      "group relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition",
      active
        ? "bg-[linear-gradient(90deg,rgb(169_131_47/0.22),rgb(169_131_47/0.04))] text-[#f7edd8] " +
          "before:absolute before:-left-2 before:top-2 before:bottom-2 before:w-[3px] " +
          "before:rounded-full before:bg-gold-soft before:content-['']"
        : "text-side-ink hover:bg-white/5 hover:text-[#f3ecdd]",
    ].join(" ");

  const item = (it: NavItem) => {
    const active = !!isActive(it.href);
    const inner = (
      <>
        <it.Icon
          width={18}
          height={18}
          className={active ? "text-gold-soft" : "opacity-70 group-hover:opacity-100"}
        />
        <span className="truncate">{it.label}</span>
      </>
    );
    return (
      <li key={it.href}>
        {it.external ? (
          <a
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={linkClass(active)}
          >
            {inner}
          </a>
        ) : (
          <Link
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={linkClass(active)}
          >
            {inner}
          </Link>
        )}
      </li>
    );
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-white/5 bg-side text-side-ink md:flex">
      {/* Бренд */}
      <Link
        href="/"
        className="flex items-center gap-3 px-5 pb-4 pt-5 transition hover:opacity-90"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[radial-gradient(120%_120%_at_30%_25%,var(--color-gold-hi),var(--color-gold)_55%,#5f4a1c)] shadow-[inset_0_1px_1px_rgb(255_255_255/0.35),0_4px_12px_-4px_rgb(169_131_47/0.6)]">
          <svg viewBox="0 0 24 24" width={19} height={19} fill="currentColor" className="text-on-gold" aria-hidden="true">
            <path d="M12 2l9 6-9 14L3 8z" opacity=".9" />
            <path d="M12 2l9 6-9 4-9-4z" opacity=".5" />
          </svg>
        </span>
        <span className="leading-tight">
          <span className="block font-serif text-lg font-bold tracking-wide text-[#f3ecdd]">
            Onyx
          </span>
          <span className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-side-muted">
            Склад камня
          </span>
        </span>
      </Link>

      {/* Навигация */}
      <nav
        aria-label="Основная навигация"
        className="flex-1 overflow-y-auto px-3 py-1"
      >
        {work.length > 0 && (
          <>
            <p className="px-3 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-side-muted">
              Работа
            </p>
            <ul className="space-y-0.5">{work.map(item)}</ul>
          </>
        )}
        {manage.length > 0 && (
          <>
            <p className="px-3 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-side-muted">
              Управление
            </p>
            <ul className="space-y-0.5">{manage.map(item)}</ul>
          </>
        )}
      </nav>

      {/* Подвал: демо-роль + выход */}
      <div className="space-y-2 border-t border-white/5 p-3">
        <DemoRoleSwitcher />
        {isLoggedIn && (
          <form action={logoutSession}>
            <button
              type="submit"
              className="flex min-h-11 w-full items-center justify-center rounded-[10px] text-xs font-semibold text-side-muted ring-1 ring-white/10 transition hover:text-side-ink hover:ring-white/25"
            >
              Выйти
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
