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
import EmptyState from "@/components/ui/EmptyState";
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
      <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
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
    <main className="max-w-[1440px] p-4 pb-12 md:p-6 xl:p-8">
      <header className="mb-6">
        <h1 className="text-display font-semibold text-ink">
          История
        </h1>
        <p className="mt-1 text-sm text-ink-2">
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
        <EmptyState title="Пока пусто — действия появятся здесь по мере работы со складом." />
      ) : (
        // ТЗ №20 §8: плотная таблица (строка ~36px, 13px) — дата, кто,
        // действие, объект, было → стало (моно, «было» зачёркнуто ink-3).
        // На телефоне — карточки (§9), таблица прокручивается внутри рамки.
        <div className="onyx-table-wrap">
          <table className="onyx-table text-[13px] leading-[18px]">
            <thead>
              <tr>
                <th className="py-2 pl-3 pr-2">Когда</th>
                <th className="hidden py-2 pr-2 md:table-cell">Кто</th>
                <th className="py-2 pr-2">Действие</th>
                <th className="py-2 pr-3">Объект и изменения</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const d = describeHistoryEntry(e, lookups);
                const actor = e.user
                  ? `${e.user.name} · ${roleLabel(e.user.role as Role)}`
                  : "Система";
                return (
                  <tr key={e.id} className="align-top">
                    <td className="tnum whitespace-nowrap py-2 pl-3 pr-2 text-ink-2">
                      {formatTashkentDateTime(e.createdAt)}
                      <span className="mt-0.5 block text-ink-2 md:hidden">{actor}</span>
                    </td>
                    <td className="hidden py-2 pr-2 text-ink-2 md:table-cell">{actor}</td>
                    <td className="py-2 pr-2">
                      <Badge variant={actionVariant(e.action)}>
                        {actionLabelRu(e.action)}
                      </Badge>
                    </td>
                    <td className="min-w-[14rem] py-2 pr-3">
                      <span className="font-medium text-ink">{d.summary}</span>
                      {d.changes.length > 0 && (
                        <ul className="mt-0.5 space-y-0.5">
                          {d.changes.map((c, i) => (
                            <li key={i}>
                              <ChangeLine text={c} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

/**
 * «Поле: было → стало» — значения моно, «было» зачёркнуто ink-3 (ТЗ №20 §8).
 * Строки другого вида показываются как есть.
 */
function ChangeLine({ text }: { text: string }) {
  const arrow = text.indexOf(" → ");
  if (arrow < 0) return <span className="tnum text-ink">{text}</span>;
  const colon = text.lastIndexOf(": ", arrow);
  const label = colon >= 0 ? text.slice(0, colon + 1) : "";
  const before = text.slice(colon >= 0 ? colon + 2 : 0, arrow);
  const after = text.slice(arrow + 3);
  return (
    <span className="text-ink">
      {label && <span className="text-ink-2">{label} </span>}
      <span className="font-mono text-ink-3 line-through">{before}</span>
      <span className="text-ink-2"> → </span>
      <span className="font-mono">{after}</span>
    </span>
  );
}
