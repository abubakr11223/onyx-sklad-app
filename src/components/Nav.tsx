"use client";

// Боковая панель (десктоп). Мобиль использует BottomTabBar — здесь
// `hidden md:flex`. Тема «Графит» (2026-11-11): тёмно-синяя панель, синяя
// метка активного раздела, две группы (Работа / Управление).
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
import { visibleNavItems, type NavItem } from "@/components/nav-items";
import { roleLabel } from "@/lib/role-labels";
import type { Capabilities, Role } from "@/lib/permissions";

// Раздел «Работа» (ежедневные операции) vs «Управление» (обзор/настройки).
const WORK = new Set(["/poisk", "/priemka", "/bron", "/prodazha", "/razbit"]);

// Инициалы для аватара пользователя в подвале.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => p[0]);
  return (chars.join("") || "?").toUpperCase();
}

export default function Nav({
  caps,
  user = null,
}: {
  caps: Capabilities;
  user?: { name: string; role: Role } | null;
}) {
  const pathname = usePathname();
  const links = visibleNavItems(caps);
  const work = links.filter((l) => WORK.has(l.href));
  const manage = links.filter((l) => !WORK.has(l.href));

  const isActive = (href: string) => href !== "/" && pathname?.startsWith(href);

  // Тема «Графит»: активный пункт — подложка side-2 + синяя метка 3px слева
  // (inset-тень, не псевдоэлемент — не съезжает при скролле списка).
  const linkClass = (active: boolean) =>
    [
      "group flex min-h-11 items-center gap-3.5 px-6 py-2.5 text-[15px] transition-colors",
      active
        ? "bg-side-2 font-medium text-white shadow-[inset_3px_0_0_var(--color-gold)]"
        : "text-side-ink hover:text-white",
    ].join(" ");

  const item = (it: NavItem) => {
    const active = !!isActive(it.href);
    const inner = (
      <>
        <it.Icon
          width={18}
          height={18}
          className={active ? "text-white" : "opacity-80 group-hover:opacity-100"}
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
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col bg-side text-side-ink md:flex">
      {/* Бренд */}
      <Link
        href="/"
        className="flex items-center gap-3 px-6 pb-6 pt-7 transition hover:opacity-90"
      >
        <svg viewBox="0 0 34 34" width={32} height={32} aria-hidden="true" className="shrink-0">
          <circle cx="17" cy="17" r="15" fill="none" stroke="#fff" strokeWidth="2.5" />
          <circle cx="17" cy="17" r="7" fill="var(--color-gold)" />
        </svg>
        <span className="leading-tight">
          <span className="block text-[22px] font-bold tracking-tight text-white">
            Onyx
          </span>
          <span className="block text-[11px] font-medium text-side-muted">
            Склад камня
          </span>
        </span>
      </Link>

      {/* Навигация */}
      <nav
        aria-label="Основная навигация"
        className="flex-1 overflow-y-auto pb-2"
      >
        {work.length > 0 && (
          <>
            <p className="px-6 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-side-muted">
              Работа
            </p>
            <ul>{work.map(item)}</ul>
          </>
        )}
        {manage.length > 0 && (
          <>
            <p className="px-6 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-side-muted">
              Управление
            </p>
            <ul>{manage.map(item)}</ul>
          </>
        )}
      </nav>

      {/* Подвал: текущий пользователь + выход (R6 — реальная сессия). */}
      <div className="border-t border-side-2 p-4">
        {user ? (
          <>
            <div className="flex items-center gap-3 px-2 py-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-semibold text-white">
                {initials(user.name)}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-medium text-white">
                  {user.name}
                </span>
                <span className="block text-[11px] text-side-muted">
                  {roleLabel(user.role)}
                </span>
              </span>
            </div>
            <form action={logoutSession} className="mt-2">
              <button
                type="submit"
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-field text-xs font-semibold text-side-ink ring-1 ring-side-2 transition hover:text-white hover:ring-side-muted"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Выйти
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/login"
            className="flex min-h-11 w-full items-center justify-center rounded-field text-xs font-semibold text-side-ink ring-1 ring-side-2 transition hover:text-white hover:ring-side-muted"
          >
            Войти
          </Link>
        )}
      </div>
    </aside>
  );
}
