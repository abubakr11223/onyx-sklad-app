"use client";

// Нижняя панель телефона (ТЗ №20 §9). Ниже 768px боковое меню превращается в
// 4 пункта роли + «Ещё». «Ещё» открывает лист со ВСЕМИ разделами роли (те же
// группы, что в боковом меню) и «Выйти» — ни один раздел не теряется на
// телефоне. `md:hidden` — на десктопе работает боковое меню.
//
// Capabilities приходят пропом с сервера (layout) — как и Nav, без мигания.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutSession } from "@/app/login/actions";
import { bottomTabItems, groupedNavItems, type NavItem } from "@/components/nav-items";
import { roleLabel } from "@/lib/role-labels";
import type { Capabilities, Role } from "@/lib/permissions";

export default function BottomTabBar({
  caps,
  user = null,
}: {
  caps: Capabilities;
  user?: { name: string; role: Role } | null;
}) {
  const pathname = usePathname();
  const items = bottomTabItems(caps);
  const groups = groupedNavItems(caps);
  const [moreOpen, setMoreOpen] = useState(false);

  // Переход на другую страницу закрывает лист «Ещё».
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const isActive = (href: string) => !!pathname?.startsWith(href);
  const inBar = new Set(items.map((i) => i.href));
  const moreActive = !!pathname && pathname !== "/" &&
    groups.some((g) => g.items.some((i) => !inBar.has(i.href) && isActive(i.href)));

  const tabClass = (active: boolean) =>
    [
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium",
      active ? "text-ink shadow-[inset_0_2px_0_var(--color-honey)]" : "text-ink-2",
    ].join(" ");

  const tab = (item: NavItem) => {
    const active = isActive(item.href);
    const inner = (
      <>
        <item.Icon width={22} height={22} strokeWidth={1.5} />
        <span className="max-w-full truncate">{item.short}</span>
      </>
    );
    const common = {
      href: item.href,
      "aria-current": active ? ("page" as const) : undefined,
      className: tabClass(active),
    };
    return (
      <li key={item.href} className="flex flex-1">
        {item.external ? <a {...common}>{inner}</a> : <Link {...common}>{inner}</Link>}
      </li>
    );
  };

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-[rgba(22,19,15,0.45)] md:hidden"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}
      {moreOpen && (
        <div
          id="onyx-more-sheet"
          role="dialog"
          aria-label="Все разделы"
          className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-50 max-h-[70dvh] overflow-y-auto rounded-t-card border-t border-line bg-marble px-4 pb-4 pt-3 shadow-pop md:hidden"
        >
          {groups.map((g) => (
            <div key={g.title} className="mt-3 first:mt-0">
              <p className="pb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-2">
                {g.title}
              </p>
              <ul className="grid grid-cols-2 gap-2">
                {g.items.map((it) => {
                  const active = isActive(it.href);
                  const cls = [
                    "flex min-h-11 items-center gap-2 rounded-field border px-3 text-sm",
                    active
                      ? "border-honey bg-honey-soft font-medium text-ink"
                      : "border-line text-ink",
                  ].join(" ");
                  const inner = (
                    <>
                      <it.Icon width={18} height={18} strokeWidth={1.5} className="shrink-0 text-ink-2" />
                      <span className="truncate">{it.label}</span>
                    </>
                  );
                  return (
                    <li key={it.href}>
                      {it.external ? (
                        <a href={it.href} className={cls}>{inner}</a>
                      ) : (
                        <Link href={it.href} className={cls} onClick={() => setMoreOpen(false)}>
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {user && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
              <span className="min-w-0 truncate text-sm text-ink">
                {user.name}
                <span className="text-ink-2"> · {roleLabel(user.role)}</span>
              </span>
              <form action={logoutSession}>
                <button
                  type="submit"
                  className="min-h-11 rounded-field border border-line-strong bg-marble px-4 text-sm font-medium text-ink"
                >
                  Выйти
                </button>
              </form>
            </div>
          )}
        </div>
      )}
      <nav
        aria-label="Основная навигация"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-marble pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto flex max-w-md items-stretch">
          {items.map(tab)}
          <li className="flex flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-controls="onyx-more-sheet"
              className={tabClass(moreOpen || moreActive)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>Ещё</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
