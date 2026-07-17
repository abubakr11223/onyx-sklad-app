"use client";

// Нижний таб-бар (мобиль, зона большого пальца). `md:hidden` — на десктопе
// работает верхний Nav. До 4 пунктов, роль-зависимые (bottomTabItems),
// текущий маршрут — золотом. safe-area снизу (домашний индикатор iPhone).
//
// Capabilities приходят пропом с сервера (layout) — как и Nav, без мигания.
// usePathname требует "use client".

import Link from "next/link";
import { usePathname } from "next/navigation";
import { bottomTabItems, type NavItem } from "@/components/nav-items";
import type { Capabilities } from "@/lib/permissions";

export default function BottomTabBar({ caps }: { caps: Capabilities }) {
  const pathname = usePathname();
  const items = bottomTabItems(caps);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : !!pathname?.startsWith(href);

  const tabClass = (active: boolean) =>
    [
      "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition",
      active ? "text-gold-deep" : "text-ink/60 hover:text-ink",
    ].join(" ");

  const inner = (item: NavItem, active: boolean) => (
    <>
      <item.Icon
        width={22}
        height={22}
        className={active ? "text-gold-deep" : "text-ink/55"}
      />
      <span className="max-w-full truncate">{item.short}</span>
    </>
  );

  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ink/10 bg-paper/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href} className="flex flex-1">
              {item.external ? (
                <a
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  {inner(item, active)}
                </a>
              ) : (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  {inner(item, active)}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
