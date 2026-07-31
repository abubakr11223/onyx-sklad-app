// Главная — роль-фильтрованные разделы (аудит: MANAGER видел «Приёмку» и
// упирался в «Нет доступа»). Тот же капабилити-фильтр, что и у навигации.
// Плитки-KPI над разделами: ТОЛЬКО дешёвые count()-агрегаты (без выборки строк),
// один Promise.all, роль-фильтр по Capabilities. Отложенный C-риск снят: строки
// не грузим, только счётчики.

import Link from "next/link";
import { getCapabilities, getCurrentUser } from "@/lib/session";
import type { Capabilities } from "@/lib/permissions";
import { db } from "@/lib/db";
import { photoTasksListWhere } from "@/lib/photo-requests";
import { visibleNavItems, type NavItem } from "@/components/nav-items";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

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
  const sections = visibleNavItems(caps);
  const stats = await loadStats(caps, user?.id ?? null);

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
    "group flex items-start gap-3 rounded-card border border-ink/10 bg-paper-2/50 p-5 " +
    "transition hover:border-gold hover:bg-paper-2 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

  const inner = (section: NavItem) => (
    <>
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-field bg-gold/12 text-gold-deep transition group-hover:bg-gold group-hover:text-ink"
      >
        <section.Icon width={22} height={22} />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold text-ink">
          {section.label}
        </span>
        <span className="mt-1 block text-sm text-ink/60">
          {section.description}
        </span>
      </span>
    </>
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · склад
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink sm:text-4xl">
          Складская система
        </h1>
        <p className="mt-2 text-lg text-ink/60">
          Учёт натурального камня: партии, плиты, остатки, брони.
        </p>
      </header>

      {tiles.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {tiles.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className="rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              <Card
                className={
                  "h-full transition hover:border-gold " +
                  (t.warning ? "border-warning/30" : "")
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={
                      "font-serif text-3xl font-bold tabular-nums " +
                      (t.warning ? "text-warning" : "text-ink")
                    }
                  >
                    {t.value}
                  </span>
                  {t.warning && t.value > 0 ? (
                    <Badge variant="warning">проверить</Badge>
                  ) : null}
                </div>
                <span className="mt-1 block text-sm text-ink/60">{t.label}</span>
              </Card>
            </Link>
          ))}
        </div>
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
