// A1 (TZ §6.8) — Лиды дизайнера/партнёра. Тонкий слой над Prisma + чистые
// хелперы статуса. Партнёрский запрос ВСЕГДА становится Lead(NEW) для менеджера —
// «ни один интерес не теряется» (§6.8.5).
//
// Уклад как у reservations.ts / photo-requests.ts: db передаётся ПАРАМЕТРОМ
// (dependency-injection), никакого top-level импорта "@/lib/db" — поэтому чистые
// хелперы (canTransitionLead, LEAD_STATUS_RU) импортируются в unit-тесты без
// инстанцирования Prisma. Типы из @prisma/client — только `import type`
// (стираются при сборке).

import type { Prisma, PrismaClient, LeadStatus } from "@prisma/client";

export type { LeadStatus };

/** Минимальный контракт клиента БД (реальный PrismaClient или tx). */
type Db = PrismaClient | Prisma.TransactionClient;

/** Все статусы лида по порядку (для UI и валидации «это вообще статус?»). */
export const LEAD_STATUSES: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "CLOSED",
] as const;

/** RU-подписи статусов (только для отображения; код-статус остаётся EN). */
export const LEAD_STATUS_RU: Record<LeadStatus, string> = {
  NEW: "Новая",
  CONTACTED: "Менеджер связался",
  CLOSED: "Закрыта",
};

/**
 * Разрешённые переходы статуса — только ВПЕРЁД (NEW → CONTACTED → CLOSED).
 * Назад/по кругу нельзя: заявка не «оживает» после закрытия (проще и честнее).
 */
export const LEAD_STATUS_FLOW: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ["CONTACTED", "CLOSED"],
  CONTACTED: ["CLOSED"],
  CLOSED: [],
};

/** Строка — валидный статус лида? (форма шлёт свободный текст.) */
export function isLeadStatus(v: string): v is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(v);
}

/** Разрешён ли переход from → to (только вперёд по потоку). */
export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_STATUS_FLOW[from]?.includes(to) ?? false;
}

/** Типизированная ошибка домена лидов (маршрутизируется в UI по .code). */
export class LeadError extends Error {
  constructor(public code: "notfound" | "status" | "transition") {
    super(code);
    this.name = "LeadError";
  }
}

export interface CreateLeadInput {
  createdById: string;
  stoneTypeId: string | null;
  requestedSlabs: number | null;
  requestedAreaM2: number | null;
  contact: string | null;
  note: string | null;
}

/**
 * Создать лид (status = NEW). Никакой авторизации/парсинга здесь — их делает
 * вызывающий action (requestLead): сюда приходят уже разобранные значения.
 */
export async function createLead(
  db: Db,
  input: CreateLeadInput,
): Promise<{ id: string }> {
  return db.lead.create({
    data: {
      createdById: input.createdById,
      stoneTypeId: input.stoneTypeId,
      requestedSlabs: input.requestedSlabs,
      requestedAreaM2: input.requestedAreaM2,
      contact: input.contact,
      note: input.note,
      status: "NEW",
    },
    select: { id: true },
  });
}

/** Строка лида для страницы /zayavki (имена связей — плоско, только нужное). */
export interface LeadListItem {
  id: string;
  status: LeadStatus;
  requestedSlabs: number | null;
  requestedAreaM2: Prisma.Decimal | null;
  contact: string | null;
  note: string | null;
  createdAt: Date;
  createdBy: { name: string };
  stoneType: { id: string; name: string } | null;
  assignedManager: { name: string } | null;
}

/**
 * Список лидов для менеджера/владельца. По умолчанию — все, новые сверху
 * (индекс status, createdAt). Опционально фильтр по статусу.
 */
export async function listLeads(
  db: Db,
  opts: { status?: LeadStatus } = {},
): Promise<LeadListItem[]> {
  return db.lead.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      requestedSlabs: true,
      requestedAreaM2: true,
      contact: true,
      note: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      stoneType: { select: { id: true, name: true } },
      assignedManager: { select: { name: true } },
    },
  });
}

/**
 * Сменить статус лида (NEW → CONTACTED → CLOSED) и закрепить менеджера,
 * взявшего заявку. Валидирует: статус существует, лид найден, переход разрешён.
 * Пишет AuditLog(STATUS_CHANGE, entityType "Lead") — БЕЗ нового enum-значения
 * (тот же приём, что accounts/actions.ts для User). Всё в одной транзакции.
 */
export async function updateLeadStatus(
  db: PrismaClient,
  params: { id: string; status: string; managerId: string },
): Promise<{ id: string; status: LeadStatus }> {
  if (!isLeadStatus(params.status)) throw new LeadError("status");
  const next = params.status;

  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!lead) throw new LeadError("notfound");
    if (!canTransitionLead(lead.status, next)) throw new LeadError("transition");

    const updated = await tx.lead.update({
      where: { id: params.id },
      data: { status: next, assignedManagerId: params.managerId },
      select: { id: true, status: true },
    });
    await tx.auditLog.create({
      data: {
        userId: params.managerId,
        action: "STATUS_CHANGE",
        entityType: "Lead",
        entityId: params.id,
        payload: {
          kind: "lead.status",
          from: lead.status,
          to: next,
        } as Prisma.InputJsonValue,
      },
    });
    return updated;
  });
}
