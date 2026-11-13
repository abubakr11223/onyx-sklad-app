// ТЗ №20 I — плитка камня в каталоге, «Похожих камнях» и подборке.
//
// Рисует ровно то, что пришло в CatalogItem (buildCatalogItem уже отобрал поля
// по роли): клиенту — без цифр; партнёру — свободно плит и м²; сотруднику —
// ещё бой/остатки и пометка «скрыт из каталога» / «нет фото».
// Клик по фото и названию — карточка /k/<код>.
import Link from "next/link";
import type { ReactNode } from "react";
import type { CatalogItem } from "@/lib/catalog";
import type { PublicDict } from "@/lib/public-i18n";
import Badge from "@/components/ui/Badge";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export type StoneTileTexts = Pick<
  PublicDict,
  | "inStock"
  | "inShowroom"
  | "outOfStockOrder"
  | "slabSizes"
  | "thicknesses"
  | "freeNow"
  | "slabsShort"
  | "m2"
  | "noPhotos"
  | "photoAlt"
>;

export default function StoneTile({
  item,
  t,
  href,
  children,
  compact = false,
}: {
  item: CatalogItem;
  t: StoneTileTexts;
  /** По умолчанию — карточка /k/<код вида>. */
  href?: string;
  /** Действия под плиткой (заявка, «В подборку», «Нравится»). */
  children?: ReactNode;
  compact?: boolean;
}) {
  const to = href ?? `/k/${item.code}`;
  const availability =
    item.availability === "IN_STOCK"
      ? t.inStock
      : item.availability === "IN_SHOWROOM"
        ? t.inShowroom
        : t.outOfStockOrder;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-line bg-marble transition-colors duration-150 hover:border-line-strong">
      <Link
        href={to}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
      >
        {item.photoId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/photo/${item.photoId}`}
            alt={`${item.name} — ${t.photoAlt}`}
            loading="lazy"
            className="aspect-[4/3] w-full bg-stone-100 object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center border-b border-dashed border-honey bg-honey-soft px-3">
            <span className="text-center text-sm font-medium text-ink-2">{t.noPhotos}</span>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Link
            href={to}
            className="text-lg font-semibold leading-tight text-ink hover:text-gold-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {item.name}
          </Link>
          <Badge variant={item.availability === "IN_STOCK" ? "success" : "neutral"}>
            {availability}
          </Badge>
        </div>
        <p className="text-sm text-ink-2">
          {[item.rockType, item.color].filter(Boolean).join(" · ")}
        </p>
        {!compact && item.sizes.length > 0 && (
          <p className="text-sm text-ink-2">
            <span className="text-ink-2">{t.slabSizes}: </span>
            <span className="tnum">{item.sizes.join(", ")}</span>
          </p>
        )}
        {!compact && item.thicknesses.length > 0 && (
          <p className="text-sm text-ink-2">
            <span className="text-ink-2">{t.thicknesses}: </span>
            <span className="tnum">{item.thicknesses.join(", ")}</span>
          </p>
        )}
        {item.viewer !== "client" && item.availability === "IN_STOCK" && (
          <p className="text-sm text-ink-2">
            {t.freeNow}:{" "}
            <span className="tnum font-semibold text-ink">
              {item.freeSlabs} {t.slabsShort} · {m2Fmt.format(item.freeAreaM2)} {t.m2}
            </span>
            {item.viewer === "staff" && item.freePieces > 0 && (
              <span className="tnum"> · бой/остатки: {item.freePieces}</span>
            )}
          </p>
        )}
        {item.viewer === "staff" && item.hiddenReason && (
          <p>
            <Badge variant="warning">
              {item.hiddenReason === "flagOff"
                ? "Скрыт из каталога — клиенты не видят"
                : "Нет фото — клиенты не видят"}
            </Badge>
          </p>
        )}
        {children && <div className="mt-auto flex flex-col gap-2 pt-1">{children}</div>}
      </div>
    </article>
  );
}
