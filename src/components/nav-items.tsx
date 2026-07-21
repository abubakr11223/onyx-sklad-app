// Onyx — единый источник разделов навигации (иконка + подпись + href).
// Используется тремя владельцами: Nav (десктоп-топ), BottomTabBar (мобиль-низ)
// и главной. Один список ⇒ иконки/подписи не расходятся.
//
// Фильтрация по роли переиспользует canAccessNav из lib/nav-access (тот же
// капабилити-фильтр, что и раньше). Плоский модуль, без "use client" —
// подходит и серверным, и клиентским потребителям.

import type { ComponentType, SVGProps } from "react";
import { canAccessNav } from "@/lib/nav-access";
import type { Capabilities } from "@/lib/permissions";
import {
  BookmarkIcon,
  CameraIcon,
  HomeIcon,
  MapIcon,
  PackageIcon,
  SaleIcon,
  SearchIcon,
  SplitIcon,
} from "./ui/Icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

// «История» — журнал действий. Локальная иконка (часы со стрелкой назад):
// в наборе Icons.tsx нет истории, а добавлять зависимость/трогать чужой файл
// незачем — иконка декоративна и используется только здесь. Те же соглашения,
// что и в Icons.tsx (viewBox 24, currentColor, 20px по умолчанию).
function HistoryIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M3 3v5h5" />
      <path d="M3.05 13a9 9 0 1 0 2.13-5.66L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export type NavItem = {
  href: string;
  label: string;
  /** Короткая подпись для узкого нижнего таб-бара. */
  short: string;
  description: string;
  Icon: IconType;
  /** Внешняя (статическая) страница — обычный <a>, не next/link. */
  external?: boolean;
};

/** Главная — не раздел, но нужна как якорь нижнего таб-бара. */
export const HOME_ITEM: NavItem = {
  href: "/",
  label: "Главная",
  short: "Главная",
  description: "Обзор и разделы",
  Icon: HomeIcon,
};

/** Разделы приложения (порядок = приоритет для нижнего таб-бара). */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/poisk",
    label: "Поиск",
    short: "Поиск",
    description: "Найти камень по названию и размеру",
    Icon: SearchIcon,
  },
  {
    href: "/priemka",
    label: "Приёмка",
    short: "Приёмка",
    description: "Завести партию за минуту",
    Icon: PackageIcon,
  },
  {
    href: "/bron",
    label: "Бронь",
    short: "Бронь",
    description: "Держать камень под клиента",
    Icon: BookmarkIcon,
  },
  {
    href: "/prodazha",
    label: "Продажа",
    short: "Продажа",
    description: "Оформить продажу и списание",
    Icon: SaleIcon,
  },
  {
    href: "/razbit",
    label: "Разбить",
    short: "Разбить",
    description: "Целый → бой / части",
    Icon: SplitIcon,
  },
  {
    href: "/fotozapros",
    label: "Фотозапросы",
    short: "Фото",
    description: "Запросы фото складчикам",
    Icon: CameraIcon,
  },
  {
    href: "/karta-sklada",
    label: "Карта",
    short: "Карта",
    description: "Где какой камень лежит",
    Icon: MapIcon,
  },
  {
    href: "/istoriya",
    label: "История",
    short: "История",
    description: "Кто что делал: приёмка, продажи, брони",
    Icon: HistoryIcon,
  },
];

/** Разделы, видимые текущей роли (тот же фильтр, что у Nav — только косметика). */
export function visibleNavItems(caps: Capabilities): NavItem[] {
  return NAV_ITEMS.filter((item) => canAccessNav(item.href, caps));
}

/**
 * До 4 пунктов для нижнего таб-бара (зона большого пальца): Главная + первые
 * доступные разделы по приоритету. Поиск открыт всем, поэтому бар никогда
 * не пустой даже для PARTNER.
 */
export function bottomTabItems(caps: Capabilities): NavItem[] {
  return [HOME_ITEM, ...visibleNavItems(caps).slice(0, 3)];
}
