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

// «Сотрудники» — управление аккаунтами (OWN-03). Локальная иконка (люди):
// в Icons.tsx нет иконки пользователей, а трогать чужой файл ради декоративной
// иконки незачем. Те же соглашения, что и в Icons.tsx (viewBox 24, currentColor).
function UsersIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// «Заявки» — лиды дизайнера/партнёра (A1, §6.8). Локальная иконка (входящий
// лоток): в Icons.tsx подходящей нет, а трогать чужой файл ради декоративной
// иконки незачем. Те же соглашения, что в Icons.tsx (viewBox 24, currentColor).
function LeadsIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

// «Должники» (TZ №9) — кошелёк. Icons.tsx да yo'q; dekorativ, faqat shu yerda.
function WalletIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}


// «Клиенты» / «Объекты» (TZ №10+11) — локальные иконки.
function ClientsIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SitesIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function SamplesIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      width={20} height={20} aria-hidden="true" className={className} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SummaryIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      width={20} height={20} aria-hidden="true" className={className} {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 16v-5" />
      <path d="M12 16V8" />
      <path d="M17 16v-9" />
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
    href: "/otgruzki",
    label: "Отгрузки",
    short: "Отгруз.",
    description: "К отгрузке и архив выдач со склада",
    Icon: PackageIcon,
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
    href: "/zayavki",
    label: "Заявки",
    short: "Заявки",
    description: "Запросы дизайнеров-партнёров",
    Icon: LeadsIcon,
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
  {
    href: "/accounts",
    label: "Сотрудники",
    short: "Люди",
    description: "Аккаунты: логины, роли, доступ",
    Icon: UsersIcon,
  },
  {
    href: "/dolzhniki",
    label: "Должники",
    short: "Долги",
    description: "Кто должен за камень, просрочки, погашение",
    Icon: WalletIcon,
  },
  {
    href: "/klienty",
    label: "Клиенты",
    short: "Клиенты",
    description: "Справочник клиентов: продажи, долги, объекты",
    Icon: ClientsIcon,
  },
  {
    href: "/obekty",
    label: "Объекты",
    short: "Объекты",
    description: "Стройки: отгрузки, суммы, статус",
    Icon: SitesIcon,
  },
  {
    href: "/obraztsy",
    label: "Образцы",
    short: "Образцы",
    description: "Камень на руках у клиента",
    Icon: SamplesIcon,
  },
  {
    href: "/svodka",
    label: "Сводка",
    short: "Сводка",
    description: "Топ клиентов и объектов, B2B vs B2C",
    Icon: SummaryIcon,
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
