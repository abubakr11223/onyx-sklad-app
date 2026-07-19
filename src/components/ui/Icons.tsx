// Onyx — минимальный inline-SVG набор (lucide-стиль, скопирован как крошечные
// компоненты — БЕЗ новой зависимости). Заменяет эмодзи (📦🔍🪓📷), которые
// рендерятся по-разному на разных устройствах (аудит: #1 «AI-признак»).
//
// Все иконы наследуют цвет через `currentColor` и масштабируются классом
// (по умолчанию 20px). Декоративны: aria-hidden — подпись даёт текст рядом.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, className, ...props }: IconProps) {
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
      {children}
    </svg>
  );
}

/** Дом — Главная. */
export function HomeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-6h6v6" />
    </Base>
  );
}

/** Лупа — Поиск. */
export function SearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Base>
  );
}

/** Коробка — Приёмка. */
export function PackageIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m12 2 8.5 4.9v9.8L12 22l-8.5-5.3V6.9L12 2Z" />
      <path d="M3.8 7.2 12 12l8.2-4.8" />
      <path d="M12 12v10" />
    </Base>
  );
}

/** Закладка — Бронь. */
export function BookmarkIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
    </Base>
  );
}

/** Купюра — Продажа. */
export function SaleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9v6M18 9v6" />
    </Base>
  );
}

/** Раскол — Разбить (целый → части). */
export function SplitIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M13 3 7 12h4l-2 9 8-11h-4l2-7Z" />
    </Base>
  );
}

/** Камера — Фотозапросы. */
export function CameraIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </Base>
  );
}

/** Карта — Готовность проекта. */
export function MapIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m9 4-6 2.5v13L9 17l6 2.5 6-2.5v-13L15 6 9 4Z" />
      <path d="M9 4v13M15 6v13" />
    </Base>
  );
}

/** Флажок — физический ориентир на складе (пронумерованный флаг, TZ §4.5). */
export function FlagIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 3.5L16 11H5" />
    </Base>
  );
}

/** Треугольник-предупреждение — состояния warning/ошибок. */
export function AlertTriangleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10.3 3.5 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.5a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Base>
  );
}
