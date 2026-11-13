// Главная — роль-фильтрованные разделы (аудит: MANAGER видел «Приёмку» и
// упирался в «Нет доступа»). Тот же капабилити-фильтр, что и у навигации.
// Плитки-KPI над разделами: ТОЛЬКО дешёвые count()-агрегаты (без выборки строк),
// один Promise.all, роль-фильтр по Capabilities. Отложенный C-риск снят: строки
// не грузим, только счётчики.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import type { Capabilities } from "@/lib/permissions";
import { db } from "@/lib/db";
import { photoTasksListWhere } from "@/lib/photo-requests";
import { visibleNavItems, type NavItem } from "@/components/nav-items";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import {
  formatStockQty,
  formatThreshold,
  loadLowStock,
  type LowStockItem,
} from "@/lib/min-stock";

export const dynamic = "force-dynamic";

/** Роль-фильтрованные KPI. null = плитка скрыта для этой роли (или сбой count). */
type Stats = {
  batches: number | null;
  needsCheck: number | null;
  photosPending: number | null;
  reservations: number | null;
};

/**
 * Дешёвые счётчики для «кокпита». Только count() — никаких строк/связей.
 * Все запросы в одном Promise.all; не запрошенные роли отдают Promise.resolve(null).
 * Любой сбой агрегата → все плитки скрыты (главная не падает; разделы остаются).
 */
async function loadStats(
  caps: Capabilities,
  managerId: string | null,
): Promise<Stats> {
  const wantBatches = caps.canSeeExactRemainder; // OWNER/MANAGER/WAREHOUSE
  const wantNeedsCheck = caps.canManageWarehouse; // OWNER/WAREHOUSE
  // Foto KPI: canViewPhotoTasks (§3/§5.9). Scope = photoTasksListWhere
  // (menejer — barcha PENDING; sklad — ochiq navbat + o'ziniki).
  const wantPhotos = caps.canViewPhotoTasks;
  // Брони: OWNER — все; MANAGER — только свои (нужен managerId, иначе скрываем,
  // чтобы не показать чужие). PARTNER/WAREHOUSE — нет.
  const wantReservations =
    caps.canReserve && (caps.canSeeAllReservations || managerId != null);

  const photoScope = photoTasksListWhere({
    canRequestPhoto: caps.canRequestPhoto,
    actorId: managerId,
  });
  // Menejer scope bo'sh → faqat PENDING; sklad scope allaqachon status:PENDING.
  const photoWhere = caps.canRequestPhoto
    ? { status: "PENDING" as const, ...photoScope }
    : photoScope;

  try {
    const [batches, nBatch, nSlab, nPiece, photosPending, reservations] =
      await Promise.all([
        wantBatches ? db.batch.count() : Promise.resolve(null),
        wantNeedsCheck
          ? db.batch.count({ where: { needsCheck: true } })
          : Promise.resolve(null),
        wantNeedsCheck
          ? db.slab.count({ where: { needsCheck: true } })
          : Promise.resolve(null),
        wantNeedsCheck
          ? db.piece.count({ where: { needsCheck: true } })
          : Promise.resolve(null),
        wantPhotos
          ? db.photoRequest.count({ where: photoWhere })
          : Promise.resolve(null),
        wantReservations
          ? db.reservation.count({
              where: {
                status: "ACTIVE",
                ...(caps.canSeeAllReservations ? {} : { managerId: managerId! }),
              },
            })
          : Promise.resolve(null),
      ]);

    return {
      batches,
      needsCheck: wantNeedsCheck
        ? (nBatch ?? 0) + (nSlab ?? 0) + (nPiece ?? 0)
        : null,
      photosPending,
      reservations,
    };
  } catch {
    return { batches: null, needsCheck: null, photosPending: null, reservations: null };
  }
}

type Tile = {
  key: string;
  value: number;
  label: string;
  href: string;
  warning?: boolean;
};

export default async function Home() {
  const [caps, user] = await Promise.all([getCapabilities(), getCurrentUser()]);
  // ТЗ №20 L (§13.2) — главная партнёра — каталог (без складских разделов).
  if (user?.role === "PARTNER") redirect("/katalog");
  const sections = visibleNavItems(caps);
  // ТЗ №20 C — блок «Заканчивается»: владелец и зав. складом (canSetMinStock).
  // Сбой расчёта не роняет главную — блок просто не показывается.
  const [stats, lowStock] = await Promise.all([
    loadStats(caps, user?.id ?? null),
    caps.canSetMinStock
      ? loadLowStock(db).catch((e): LowStockItem[] => {
          console.warn("[home] loadLowStock:", e);
          return [];
        })
      : Promise.resolve([] as LowStockItem[]),
  ]);

  const tiles: Tile[] = [];
  if (stats.batches != null)
    tiles.push({ key: "batches", value: stats.batches, label: "Партии", href: "/poisk" });
  if (stats.needsCheck != null)
    tiles.push({
      key: "needsCheck",
      value: stats.needsCheck,
      label: "Требует проверки",
      href: "/poisk",
      warning: true,
    });
  if (stats.photosPending != null)
    tiles.push({
      key: "photos",
      value: stats.photosPending,
      label: "Фото в очереди",
      href: "/fotozapros",
    });
  if (stats.reservations != null)
    tiles.push({
      key: "reservations",
      value: stats.reservations,
      label: "Активные брони",
      href: "/bron",
    });

  const cardClass =
    "group flex items-start gap-3 rounded-card border border-line bg-marble p-5 " +
    "transition-colors duration-150 hover:border-line-strong " +
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-honey-soft";

  const inner = (section: NavItem) => (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-field bg-stone-100 text-ink-2"
      >
        <section.Icon width={18} height={18} strokeWidth={1.5} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">
          {section.label}
        </span>
        <span className="mt-1 block text-sm text-ink-2">
          {section.description}
        </span>
      </span>
    </>
  );

  return (
    <main className="mx-auto max-w-6xl p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-8">
        <h1 className="text-display font-semibold text-ink">
          Складская система
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Учёт натурального камня: партии, плиты, остатки, брони.
        </p>
      </header>

      {tiles.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {tiles.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className="rounded-card focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-honey-soft"
            >
              <Card
                className={
                  "h-full transition-colors duration-150 hover:border-line-strong " +
                  (t.warning && t.value > 0 ? "border-amber/30" : "")
                }
              >
                {/* ТЗ №20 §7.5: подпись 12px сверху, цифра 28px Medium. */}
                <div className="flex items-start justify-between gap-2">
                  <span className="block text-xs font-medium text-ink-2">{t.label}</span>
                  {t.warning && t.value > 0 ? (
                    <Badge variant="warning">проверить</Badge>
                  ) : null}
                </div>
                <span
                  className={
                    "mt-1 block text-[28px] font-medium leading-9 tabular-nums " +
                    (t.warning && t.value > 0 ? "text-amber" : "text-ink")
                  }
                >
                  {t.value}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {lowStock.length > 0 && (
        <Card className="mb-8">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">Заканчивается</h2>
            <Badge variant="warning">пора заказывать</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Свободный остаток вида ниже минимального (без броней, шоу-рума и образцов).
          </p>
          <div className="onyx-table-wrap mt-3">
          <table className="onyx-table">
            <thead>
              <tr>
                <th className="py-2 pl-3 pr-2 font-medium">Вид</th>
                <th className="py-2 pr-2 text-right font-medium">Остаток</th>
                <th className="py-2 pr-3 text-right font-medium">Порог</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((item) => (
                <tr key={item.stoneTypeId}>
                  <td className="py-2 pl-3 pr-2">
                    <Link
                      href={`/kamen/${item.stoneTypeId}`}
                      className="font-medium text-ink hover:text-gold-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                      {item.name}
                    </Link>
                  </td>
                  <td className="tnum py-2 pr-2 text-right font-semibold text-warning">
                    {formatStockQty(item.free, item.threshold.unit)}
                  </td>
                  <td className="tnum py-2 pr-3 text-right text-ink-2">
                    {formatThreshold(item.threshold)}
                    {item.threshold.unit === "SLABS" ? " пл." : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) =>
          section.external ? (
            <a key={section.href} href={section.href} className={cardClass}>
              {inner(section)}
            </a>
          ) : (
            <Link key={section.href} href={section.href} className={cardClass}>
              {inner(section)}
            </Link>
          ),
        )}
      </div>

    </main>
  );
}
