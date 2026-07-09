"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = {
  href: string;
  label: string;
  emoji?: string;
  /** Внешняя (статическая) страница — рендерим обычным <a>, не next/link. */
  external?: boolean;
};

const LINKS: NavLink[] = [
  { href: "/priemka", label: "Приёмка", emoji: "📦" },
  { href: "/poisk", label: "Поиск", emoji: "🔍" },
  { href: "/bron", label: "Бронь", emoji: "🔖" },
  { href: "/prodazha", label: "Продажа", emoji: "💰" },
  { href: "/razbit", label: "Разбить", emoji: "🪓" },
  { href: "/fotozapros", label: "Фотозапросы", emoji: "📷" },
  { href: "/karta", label: "Карта", emoji: "🗺️", external: true },
];

export default function Nav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href !== "/" && pathname?.startsWith(href);

  const linkClass = (active: boolean) =>
    [
      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition",
      active
        ? "bg-gray-100 font-semibold text-gray-900"
        : "text-gray-500 hover:text-gray-900 hover:bg-gray-50",
    ].join(" ");

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5">
        <Link
          href="/"
          className="shrink-0 whitespace-nowrap text-lg font-bold tracking-wide text-gray-900"
        >
          Onyx
          <span className="ml-1 text-sm font-normal text-gray-400">· склад</span>
        </Link>

        <nav className="flex-1 overflow-x-auto">
          <ul className="flex items-center gap-1 whitespace-nowrap">
            {LINKS.map((link) => {
              const active = !!isActive(link.href);
              return (
                <li key={link.href}>
                  {link.external ? (
                    <a href={link.href} className={linkClass(active)}>
                      {link.emoji && (
                        <span aria-hidden="true">{link.emoji}</span>
                      )}
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className={linkClass(active)}>
                      {link.emoji && (
                        <span aria-hidden="true">{link.emoji}</span>
                      )}
                      {link.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
