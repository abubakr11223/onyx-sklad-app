// «История» (TZ §8 + §3) — журнал действий: кто / что / когда. Читает AuditLog,
// который пишется транзакционно вместе с каждой операцией (приёмка, продажа,
// бронь, разбитие, перемещение…).
//
// Ролевой гейт (defense-in-depth, как /karta-sklada): журнал видит ТОЛЬКО OWNER
// (canSeeHistory) — «Владелец видит действия сотрудников» (TZ §3). Менеджер,
// складчик и дизайнер-партнёр → <NoAccess/>.
//
// W8-B: архив продаж (фильтр + пагинация) живёт на /prodazha#sales — менеджер
// видит свои, владелец — все. Здесь только явная ссылка (AuditLog ≠ SaleRecord).
//
// ТЗ №19 E2: строка показывает содержание — объект, количество, узор, локацию,
// для правок «было → стало» (describeHistoryEntry). Имена камня/клиента/узора,
// которых нет в payload, догружаются ПАКЕТНО: по одному findMany на тип
// сущности для всей страницы (не N+1).
//
// Server component; force-dynamic — всегда актуальное состояние журнала.

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getCapabilities } from "@/lib/session";
import { formatTashkentDateTime } from "@/lib/datetime";
import { roleLabel } from "@/lib/role-labels";
import {
  actionLabelRu,
  actionVariant,
  collectHistoryRefs,
  describeHistoryEntry,
  type HistoryLookups,
  type HistoryRow,
} from "@/lib/history-labels";
import type { Role } from "@/lib/permissions";
import NoAccess from "@/components/NoAccess";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "История — Onyx",
};

/** Сколько последних записей показываем (v1 — без пагинации, TZ §9). */
const HISTORY_LIMIT = 100;

const ids = (set: Set<string>) => [...set];
const dec = (v: { toString(): string } | null | undefined): number | null =>
  v == null ? null : Number(v.toString());

/**
 * Справочники для describeHistoryEntry: один запрос на тип сущности, все
 * параллельно. Пустой набор id → запрос не делается.
 */
async function loadHistoryLookups(
  rows: readonly HistoryRow[],
): Promise<HistoryLookups> {
  const r = collectHistoryRefs(rows);
  const stone = { select: { stoneType: { select: { name: true } } } };
  const [batches, slabs, pieces, patterns, clients, sales, locations, shipments, samples] =
    await Promise.all([
      r.batchIds.size
        ? db.batch.findMany({
            where: { id: { in: ids(r.batchIds) } },
            select: { id: true, stoneType: { select: { name: true } } },
          })
        : [],
      r.slabIds.size
        ? db.slab.findMany({
            where: { id: { in: ids(r.slabIds) } },
            select: { id: true, label: true, stoneType: { select: { name: true } } },
          })
        : [],
      r.pieceIds.size
        ? db.piece.findMany({
            where: { id: { in: ids(r.pieceIds) } },
            select: { id: true, stoneType: { select: { name: true } } },
          })
        : [],
      r.patternIds.size
        ? db.batchPattern.findMany({
            where: { id: { in: ids(r.patternIds) } },
            select: { id: true, description: true },
          })
        : [],
      r.clientIds.size
        ? db.client.findMany({
            where: { id: { in: ids(r.clientIds) } },
            select: { id: true, name: true },
          })
        : [],
      r.saleIds.size
        ? db.saleRecord.findMany({
            where: { id: { in: ids(r.saleIds) } },
            select: { id: true, customerName: true },
          })
        : [],
      r.locationIds.size
        ? db.batchLocation.findMany({
            where: { id: { in: ids(r.locationIds) } },
            select: { id: true, block: true, landmark: true, batch: stone },
          })
        : [],
      r.shipmentIds.size
        ? db.shipment.findMany({
            where: { id: { in: ids(r.shipmentIds) } },
            select: {
              id: true,
              client: { select: { name: true } },
              saleRecord: { select: { customerName: true } },
              lines: {
                select: {
                  id: true,
                  locationSnapshot: true,
                  batchPattern: { select: { description: true } },
                  batch: stone,
                  slab: { select: { label: true, stoneType: { select: { name: true } } } },
                  piece: { select: { stoneType: { select: { name: true } } } },
                },
              },
            },
          })
        : [],
      r.sampleIds.size
        ? db.sample.findMany({
            where: { id: { in: ids(r.sampleIds) } },
            select: {
              id: true,
              qtySlabs: true,
              qtyAreaM2: true,
              client: { select: { name: true } },
              batchPattern: { select: { description: true } },
              batch: stone,
              slab: { select: { label: true, stoneType: { select: { name: true } } } },
              piece: { select: { stoneType: { select: { name: true } } } },
            },
          })
        : [],
    ]);

  return {
    batches: new Map(batches.map((b) => [b.id, { stoneName: b.stoneType.name }])),
    slabs: new Map(
      slabs.map((s) => [s.id, { stoneName: s.stoneType.name, label: s.label }]),
    ),
    pieces: new Map(pieces.map((p) => [p.id, { stoneName: p.stoneType.name }])),
    patterns: new Map(patterns.map((p) => [p.id, p.description])),
    clients: new Map(clients.map((c) => [c.id, c.name])),
    sales: new Map(sales.map((s) => [s.id, { customerName: s.customerName }])),
    locations: new Map(
      locations.map((l) => [
        l.id,
        { stoneName: l.batch.stoneType.name, block: l.block, landmark: l.landmark },
      ]),
    ),
    shipments: new Map(
      shipments.map((s) => [
        s.id,
        {
          clientName: s.client?.name ?? s.saleRecord?.customerName ?? null,
          lines: s.lines.map((l) => ({
            id: l.id,
            stoneName:
              l.batch?.stoneType.name ??
              l.slab?.stoneType.name ??
              l.piece?.stoneType.name ??
              null,
            patternLabel: l.batchPattern?.description ?? null,
            location: l.locationSnapshot,
            unitLabel: l.slab?.label ?? (l.piece ? "Бой/остаток" : null),
          })),
        },
      ]),
    ),
    samples: new Map(
      samples.map((s) => [
        s.id,
        {
          stoneName:
            s.batch?.stoneType.name ??
            s.slab?.stoneType.name ??
            s.piece?.stoneType.name ??
            null,
          clientName: s.client.name,
          unitLabel: s.slab?.label ?? (s.piece ? "Бой/остаток" : null),
          patternLabel: s.batchPattern?.description ?? null,
          qtySlabs: s.qtySlabs,
          qtyAreaM2: dec(s.qtyAreaM2),
        },
      ]),
    ),
  };
}

export default async function IstoriyaPage() {
  // Ролевой гейт — ПЕРВЫМ делом (как /karta-sklada).
  const caps = await getCapabilities();
  if (!caps.canSeeHistory) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
        <NoAccess />
      </main>
    );
  }

  // Последние записи журнала + имя/роль актёра (userId может быть null —
  // системное действие, например cron RESERVE_EXPIRE).
  const entries = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      payload: true,
      createdAt: true,
      user: { select: { name: true, role: true } },
    },
  });
  const lookups = await loadHistoryLookups(entries);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-12 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
          Onyx · журнал
        </p>
        <h1 className="mt-2 font-serif text-display font-bold tracking-tight text-ink">
          История
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Кто что делал: приёмка, продажи, брони, разбитие и перемещения.
          Последние {HISTORY_LIMIT} действий, новые сверху.
        </p>
        <p className="mt-3">
          <Link href="/prodazha#sales" className={buttonClass("secondary", "sm")}>
            Архив продаж (фильтр по дате и клиенту) →
          </Link>
        </p>
      </header>

      {entries.length === 0 ? (
        <Card>
          <p className="text-sm text-ink/70">
            Пока пусто — действия появятся здесь по мере работы со складом.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const d = describeHistoryEntry(e, lookups);
            const actor = e.user
              ? `${e.user.name} · ${roleLabel(e.user.role as Role)}`
              : "Система";
            return (
              <li
                key={e.id}
                className="rounded-card border border-line bg-paper p-3 text-sm text-ink/80"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant={actionVariant(e.action)}>
                    {actionLabelRu(e.action)}
                  </Badge>
                  <span className="font-medium text-ink">{d.summary}</span>
                </div>
                {d.changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-ink/75">
                    {d.changes.map((c, i) => (
                      <li key={i} className="tabular-nums">
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 text-ink/60">
                  {actor} · {formatTashkentDateTime(e.createdAt)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
