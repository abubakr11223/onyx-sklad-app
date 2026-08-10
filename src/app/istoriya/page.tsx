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
  entityLabelRu,
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

/** Первое непустое строковое значение из payload по списку ключей. */
function payloadString(payload: unknown, keys: string[]): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * «Над чем» — читаемое описание объекта действия из payload (стабильных полей,
 * которые пишут действия) с откатом на тип+короткий id сущности. Пример:
 * «Травертин Classic», «Плита №2», «клиент Иван», «Партия #a1b2c3d4».
 */
function targetLabel(row: {
  entityType: string;
  entityId: string;
  payload: unknown;
}): string {
  const stone = payloadString(row.payload, ["stoneName"]);
  if (stone) return stone;
  const slab = payloadString(row.payload, ["slabLabel"]);
  if (slab) return slab;
  const customer = payloadString(row.payload, ["customerName"]);
  if (customer) return `клиент ${customer}`;
  const entity = entityLabelRu(row.entityType);
  return `${entity} #${row.entityId.slice(0, 8)}`;
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
                  <span className="font-medium text-ink">
                    {targetLabel(e)}
                  </span>
                </div>
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
