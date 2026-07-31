// A1 / W8-A (TZ §6.8) — Лиды дизайнера/партнёра. Тонкий слой над Prisma +
// чистые хелперы. Партнёрский REQUEST и пассивный VIEW (§6.8.5 «даже если
// дизайнер просто посмотрел») становятся Lead(NEW) для менеджера.
//
// Уклад как у reservations.ts / photo-requests.ts: db передаётся ПАРАМЕТРОМ
// (dependency-injection), никакого top-level импорта "@/lib/db" — поэтому чистые
// хелперы (canTransitionLead, LEAD_STATUS_RU) импортируются в unit-тесты без
// инстанцирования Prisma. Типы из @prisma/client — только `import type`
// (стираются при сборке).

import type { Prisma, PrismaClient, LeadStatus, LeadKind } from "@prisma/client";

export type { LeadStatus, LeadKind };

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

/** W8-A — kind labels: manager must never confuse view with request. */
export const LEAD_KIND_RU: Record<LeadKind, string> = {
  REQUEST: "Заявка",
  VIEW: "Интерес (посмотрел)",
};

export const LEAD_KINDS: readonly LeadKind[] = ["REQUEST", "VIEW"] as const;

export function isLeadKind(v: string): v is LeadKind {
  return (LEAD_KINDS as readonly string[]).includes(v);
}

/**
 * Pure rule for passive VIEW (unit-tested, no DB).
 * Meaningful signal = identified PARTNER opened a stone card once.
 * Dedupe:
 *  - open REQUEST for same partner+stone → skip (request is stronger)
 *  - open VIEW for same pair → touch existing (no second row)
 *  - else → create one VIEW lead
 */
export function decidePassiveViewAction(input: {
  existingOpenRequest: boolean;
  existingOpenViewId: string | null;
}): "skip" | "create" | { touch: string } {
  if (input.existingOpenRequest) return "skip";
  if (input.existingOpenViewId) return { touch: input.existingOpenViewId };
  return "create";
}

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
  /** Default REQUEST (explicit form). VIEW only via recordPassiveView. */
  kind?: LeadKind;
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
      kind: input.kind ?? "REQUEST",
      requestedSlabs: input.requestedSlabs,
      requestedAreaM2: input.requestedAreaM2,
      contact: input.contact,
      note: input.note,
      status: "NEW",
    },
    select: { id: true },
  });
}

/**
 * W8-A / §6.8.5 — passive interest: identified PARTNER opened a stone card.
 * Not called on anonymous / non-PARTNER. Not on every list render — only stone
 * detail open (caller: kamen/[id] page once per navigation).
 *
 * Dedupe: at most one open (NEW|CONTACTED) VIEW per (partner, stoneType).
 * If an open REQUEST already exists for the pair, skip VIEW (request wins).
 * Returns { id, created } for tests.
 */
export async function recordPassiveView(
  db: Db,
  input: { createdById: string; stoneTypeId: string },
): Promise<{ id: string; created: boolean }> {
  const stoneTypeId = input.stoneTypeId.trim();
  if (!stoneTypeId) {
    return { id: "", created: false };
  }

  const open = await db.lead.findMany({
    where: {
      createdById: input.createdById,
      stoneTypeId,
      status: { in: ["NEW", "CONTACTED"] },
      kind: { in: ["VIEW", "REQUEST"] },
    },
    select: { id: true, kind: true },
    // Bound: partner rarely has > a few open leads on one stone.
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  const existingOpenRequest = open.some((l) => l.kind === "REQUEST");
  const existingOpenViewId =
    open.find((l) => l.kind === "VIEW")?.id ?? null;

  const decision = decidePassiveViewAction({
    existingOpenRequest,
    existingOpenViewId,
  });

  if (decision === "skip") {
    // Stronger signal already exists — return that request id for tracing.
    const req = open.find((l) => l.kind === "REQUEST")!;
    return { id: req.id, created: false };
  }
  if (typeof decision === "object" && "touch" in decision) {
    // Touch updatedAt so manager sees recent interest without a new row.
    await db.lead.update({
      where: { id: decision.touch },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
    return { id: decision.touch, created: false };
  }

  const created = await db.lead.create({
    data: {
      createdById: input.createdById,
      stoneTypeId,
      kind: "VIEW",
      requestedSlabs: null,
      requestedAreaM2: null,
      contact: null,
      note: null,
      status: "NEW",
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/** Строка лида для страницы /zayavki (имена связей — плоско, только нужное). */
export interface LeadListItem {
  id: string;
  status: LeadStatus;
  kind: LeadKind;
  requestedSlabs: number | null;
  requestedAreaM2: Prisma.Decimal | null;
  contact: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { name: string };
  stoneType: { id: string; name: string } | null;
  assignedManager: { name: string } | null;
}

/** Hard cap for manager queue — avoids unbounded scan. */
export const LEAD_LIST_LIMIT = 200;

/**
 * Список лидов для менеджера/владельца. По умолчанию — все, новые сверху
 * (индекс status, createdAt). Опционально фильтр по статусу. Always bounded.
 */
export async function listLeads(
  db: Db,
  opts: { status?: LeadStatus; take?: number } = {},
): Promise<LeadListItem[]> {
  const take = Math.min(
    Math.max(opts.take ?? LEAD_LIST_LIMIT, 1),
    LEAD_LIST_LIMIT,
  );
  return db.lead.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      status: true,
      kind: true,
      requestedSlabs: true,
      requestedAreaM2: true,
      contact: true,
      note: true,
      createdAt: true,
      updatedAt: true,
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
