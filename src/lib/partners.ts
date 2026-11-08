// ТЗ №20 L — кабинет партнёра (часть 3 договора).
//
//   • тип партнёра (дизайнер / прораб / подрядчик) и закреплённый менеджер;
//   • «Заявка на объём»: камень, объём (плиты или м²), объект текстом, срок,
//     комментарий → «Заявки» + Telegram закреплённому менеджеру (нет его или
//     нет у него Telegram — всем активным менеджерам и владельцу, как §9.2);
//   • интересы (просмотр карточки, скачивание текстуры) уведомляют того же
//     менеджера, без кнопки «взял»;
//   • «Мои заявки» партнёра;
//   • заявка → продажа: префилл формы продажи и закрытие заявки со ссылкой;
//   • блок «Партнёры» в «Сводке» владельца.

import type { LeadKind, LeadStatus, PartnerType, Prisma, PrismaClient } from "@prisma/client";
import type { SendMessageOptions, SendResult } from "./telegram";
import { leadClaimKeyboard } from "./public-lead";
import { parsePositiveDecimal, parsePositiveInt } from "./validators/intake";
import { netDecStr } from "./sale-net";

import { PARTNER_TYPE_RU } from "./partner-labels";
export { PARTNER_TYPES, PARTNER_TYPE_RU, isPartnerType } from "./partner-labels";

export const PARTNER_SITE_MAX = 200;
export const PARTNER_NOTE_MAX = 1000;

// ───────────────────────── «Заявка на объём» ─────────────────────────

export type VolumeRequestError =
  | "volume"
  | "slabs"
  | "area"
  | "due"
  | "site"
  | "note";

export const VOLUME_REQUEST_ERROR_RU: Record<VolumeRequestError, string> = {
  volume: "Укажите объём: плиты или м².",
  slabs: "Плиты — целое положительное число.",
  area: "Площадь — положительное число, например 12,5.",
  due: "Срок — дата не раньше сегодняшней.",
  site: `Объект — не длиннее ${PARTNER_SITE_MAX} символов.`,
  note: `Комментарий — не длиннее ${PARTNER_NOTE_MAX} символов.`,
};

export interface VolumeRequestInput {
  requestedSlabs: number | null;
  requestedAreaM2: number | null;
  siteText: string | null;
  dueDate: Date | null;
  note: string | null;
}

/** Дата «сегодня» по Ташкенту (YYYY-MM-DD) — нижняя граница срока. */
export function tashkentToday(now: Date): string {
  return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Разбор формы партнёра. Объём обязателен (плиты ИЛИ м²), остальное —
 * необязательно. Срок — дата (полдень по Ташкенту, чтобы день не «съезжал»).
 */
export function parseVolumeRequest(
  raw: {
    requestedSlabs?: string | null;
    requestedAreaM2?: string | null;
    siteText?: string | null;
    dueDate?: string | null;
    note?: string | null;
  },
  now: Date = new Date(),
): { ok: true; value: VolumeRequestInput } | { ok: false; error: VolumeRequestError } {
  const slabs = parsePositiveInt(String(raw.requestedSlabs ?? ""));
  if (slabs === undefined) return { ok: false, error: "slabs" };
  const area = parsePositiveDecimal(String(raw.requestedAreaM2 ?? ""));
  if (area === undefined) return { ok: false, error: "area" };
  if (slabs == null && area == null) return { ok: false, error: "volume" };

  const site = String(raw.siteText ?? "").trim();
  if (site.length > PARTNER_SITE_MAX) return { ok: false, error: "site" };
  const note = String(raw.note ?? "").trim();
  if (note.length > PARTNER_NOTE_MAX) return { ok: false, error: "note" };

  let dueDate: Date | null = null;
  const dueRaw = String(raw.dueDate ?? "").trim();
  if (dueRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueRaw) || dueRaw < tashkentToday(now)) {
      return { ok: false, error: "due" };
    }
    dueDate = new Date(`${dueRaw}T12:00:00+05:00`);
    if (Number.isNaN(dueDate.getTime())) return { ok: false, error: "due" };
  }

  return {
    ok: true,
    value: {
      requestedSlabs: slabs ?? null,
      requestedAreaM2: area ?? null,
      siteText: site || null,
      dueDate,
      note: note || null,
    },
  };
}

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const dayFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Tashkent",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** «10 плит · 25 м²» / «объём не указан». */
export function volumeText(slabs: number | null, areaM2: number | null): string {
  const parts: string[] = [];
  if (slabs != null) parts.push(`${slabs} плит`);
  if (areaM2 != null) parts.push(`${m2Fmt.format(areaM2)} м²`);
  return parts.length > 0 ? parts.join(" · ") : "объём не указан";
}

export function formatDueDate(d: Date | null): string | null {
  return d ? dayFmt.format(d) : null;
}

// ───────────────────────── Telegram ─────────────────────────

export interface PartnerLeadFacts {
  kind: LeadKind;
  partnerName: string;
  partnerType: PartnerType | null;
  stoneName: string | null;
  stoneCode: string | null;
  requestedSlabs: number | null;
  requestedAreaM2: number | null;
  siteText: string | null;
  dueDate: Date | null;
  note: string | null;
  contact: string | null;
}

function who(f: Pick<PartnerLeadFacts, "partnerName" | "partnerType">): string {
  return f.partnerType ? `${f.partnerName} (${PARTNER_TYPE_RU[f.partnerType].toLowerCase()})` : f.partnerName;
}

/** Текст уведомления менеджеру о заявке или интересе партнёра. */
export function formatPartnerLeadNotification(f: PartnerLeadFacts): string {
  const stone = [f.stoneName ?? "камень не указан", f.stoneCode].filter(Boolean).join(" ");
  if (f.kind === "VIEW") return `Интерес партнёра: ${who(f)} смотрит ${stone}`;
  if (f.kind === "TEXTURE_DOWNLOAD") {
    return `Интерес партнёра: ${who(f)} скачал текстуру ${stone} — закладывает в 3D-проект`;
  }
  const lines = [
    `Заявка партнёра: ${stone}, ${volumeText(f.requestedSlabs, f.requestedAreaM2)}`,
    `Партнёр: ${who(f)}`,
  ];
  if (f.siteText) lines.push(`Объект: ${f.siteText}`);
  const due = formatDueDate(f.dueDate);
  if (due) lines.push(`Срок: ${due}`);
  if (f.contact) lines.push(`Контакт: ${f.contact}`);
  if (f.note) lines.push(`Комментарий: ${f.note}`);
  return lines.join("\n");
}

type RecipientDb = Pick<PrismaClient, "user">;

/**
 * Кому слать: закреплённый менеджер партнёра, если он активен и с Telegram;
 * иначе всем активным менеджерам и владельцу с Telegram (как §9.2).
 */
export async function partnerLeadRecipients(
  db: RecipientDb,
  partnerId: string,
): Promise<string[]> {
  const partner = await db.user.findUnique({
    where: { id: partnerId },
    select: {
      partnerManager: {
        select: { telegramId: true, isActive: true, role: true },
      },
    },
  });
  const m = partner?.partnerManager;
  if (m && m.isActive && m.telegramId && (m.role === "MANAGER" || m.role === "OWNER")) {
    return [m.telegramId];
  }
  const all = await db.user.findMany({
    where: { isActive: true, role: { in: ["OWNER", "MANAGER"] }, telegramId: { not: null } },
    select: { telegramId: true },
  });
  return all.map((u) => u.telegramId!);
}

export type SendFn = (chatId: string, text: string, opts?: SendMessageOptions) => Promise<SendResult>;

type NotifyDb = Pick<PrismaClient, "user" | "lead">;

/**
 * Уведомить о заявке/интересе партнёра (после коммита). Заявка — с кнопкой
 * «Менеджер связался» (первый нажавший — ответственный), интерес — просто
 * текст. Ошибки только в лог: заявка уже сохранена.
 */
export async function notifyPartnerLeadSafe(
  db: NotifyDb,
  send: SendFn,
  leadId: string,
): Promise<number> {
  try {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        kind: true,
        createdById: true,
        requestedSlabs: true,
        requestedAreaM2: true,
        siteText: true,
        dueDate: true,
        note: true,
        contact: true,
        stoneCode: true,
        createdBy: { select: { name: true, role: true, partnerType: true } },
        stoneType: { select: { name: true, code: true } },
      },
    });
    if (!lead || !lead.createdById || lead.createdBy?.role !== "PARTNER") return 0;
    const text = formatPartnerLeadNotification({
      kind: lead.kind,
      partnerName: lead.createdBy.name,
      partnerType: lead.createdBy.partnerType,
      stoneName: lead.stoneType?.name ?? null,
      stoneCode: lead.stoneCode ?? lead.stoneType?.code ?? null,
      requestedSlabs: lead.requestedSlabs,
      requestedAreaM2: lead.requestedAreaM2 == null ? null : Number(lead.requestedAreaM2),
      siteText: lead.siteText,
      dueDate: lead.dueDate,
      note: lead.note,
      contact: lead.contact,
    });
    const to = await partnerLeadRecipients(db, lead.createdById);
    const opts = lead.kind === "REQUEST" ? { reply_markup: leadClaimKeyboard(lead.id) } : undefined;
    const results = await Promise.allSettled(to.map((chat) => send(chat, text, opts)));
    return results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  } catch (e) {
    console.warn("[partners] уведомление не отправлено:", e);
    return 0;
  }
}

// ───────────────────────── «Мои заявки» ─────────────────────────

export interface MyLeadRow {
  id: string;
  status: LeadStatus;
  createdAt: Date;
  stoneName: string | null;
  stoneCode: string | null;
  volume: string;
  siteText: string | null;
  due: string | null;
  note: string | null;
  managerName: string | null;
}

export const MY_LEADS_LIMIT = 100;

/** Только свои явные заявки (интересы партнёру не показываем — это служебное). */
export async function loadMyLeads(
  db: Pick<PrismaClient, "lead">,
  partnerId: string,
): Promise<MyLeadRow[]> {
  const rows = await db.lead.findMany({
    where: { createdById: partnerId, kind: "REQUEST" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MY_LEADS_LIMIT,
    select: {
      id: true,
      status: true,
      createdAt: true,
      requestedSlabs: true,
      requestedAreaM2: true,
      siteText: true,
      dueDate: true,
      note: true,
      stoneCode: true,
      stoneType: { select: { name: true, code: true } },
      assignedManager: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    stoneName: r.stoneType?.name ?? null,
    stoneCode: r.stoneCode ?? r.stoneType?.code ?? null,
    volume: volumeText(r.requestedSlabs, r.requestedAreaM2 == null ? null : Number(r.requestedAreaM2)),
    siteText: r.siteText,
    due: formatDueDate(r.dueDate),
    note: r.note,
    managerName: r.assignedManager?.name ?? null,
  }));
}

// ───────────────────────── Заявка → продажа ─────────────────────────

export interface LeadSalePrefill {
  leadId: string;
  stoneTypeId: string;
  stoneName: string;
  qtySlabs: string;
  qtyAreaM2: string;
  siteText: string | null;
  due: string | null;
  partnerName: string;
  partnerType: PartnerType | null;
}

/**
 * Префилл формы продажи из заявки партнёра. Только открытая явная заявка
 * партнёра с камнем и ещё без продажи; иначе null (форма как обычно).
 */
export async function loadLeadSalePrefill(
  db: Pick<PrismaClient, "lead">,
  leadId: string | null | undefined,
): Promise<LeadSalePrefill | null> {
  if (!leadId) return null;
  const l = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      kind: true,
      status: true,
      saleRecordId: true,
      requestedSlabs: true,
      requestedAreaM2: true,
      siteText: true,
      dueDate: true,
      stoneType: { select: { id: true, name: true } },
      createdBy: { select: { name: true, role: true, partnerType: true } },
    },
  });
  if (!l || !l.stoneType || !l.createdBy || l.createdBy.role !== "PARTNER") return null;
  if (l.kind !== "REQUEST" || l.status === "CLOSED" || l.saleRecordId) return null;
  return {
    leadId: l.id,
    stoneTypeId: l.stoneType.id,
    stoneName: l.stoneType.name,
    qtySlabs: l.requestedSlabs != null ? String(l.requestedSlabs) : "",
    qtyAreaM2: l.requestedAreaM2 != null ? String(Number(l.requestedAreaM2)).replace(".", ",") : "",
    siteText: l.siteText,
    due: formatDueDate(l.dueDate),
    partnerName: l.createdBy.name,
    partnerType: l.createdBy.partnerType,
  };
}

/**
 * После продажи: закрыть заявку со ссылкой на продажу. Условие в UPDATE
 * (открыта, без продажи, камень тот же) — повторная или чужая отправка ничего
 * не ломает. «История» — STATUS_CHANGE по заявке. Возвращает, закрыли ли.
 */
export async function closeLeadWithSale(
  db: Pick<PrismaClient, "$transaction">,
  args: { leadId: string; saleId: string; managerId: string; stoneTypeId: string },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const res = await tx.lead.updateMany({
      where: {
        id: args.leadId,
        kind: "REQUEST",
        status: { not: "CLOSED" },
        saleRecordId: null,
        stoneTypeId: args.stoneTypeId,
      },
      data: { status: "CLOSED", saleRecordId: args.saleId, assignedManagerId: args.managerId },
    });
    if (res.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        userId: args.managerId,
        action: "STATUS_CHANGE",
        entityType: "Lead",
        entityId: args.leadId,
        payload: { kind: "lead.sale", to: "CLOSED", saleRecordId: args.saleId } as Prisma.InputJsonValue,
      },
    });
    return true;
  });
}

// ───────────────────────── «Сводка» → «Партнёры» ─────────────────────────

export interface PartnerSummaryRow {
  partnerId: string;
  name: string;
  type: PartnerType | null;
  managerName: string | null;
  requests: number;
  interests: number;
  sales: number;
  amountUzs: number;
  amountUsd: number;
}

type SummaryDb = Pick<PrismaClient, "user" | "lead">;

/**
 * По каждому партнёру за период: заявки, интересы (просмотр + текстура),
 * продажи по его заявкам и их сумма (сум и $ раздельно, за вычетом возвратов).
 * Период — по дате заявки (для продаж — по дате продажи).
 */
export async function loadPartnerSummary(
  db: SummaryDb,
  range: { from: Date | null; to: Date | null },
): Promise<PartnerSummaryRow[]> {
  const created: Prisma.DateTimeFilter = {};
  if (range.from) created.gte = range.from;
  if (range.to) created.lt = range.to;
  const hasRange = range.from !== null || range.to !== null;

  const [partners, counts, sold] = await Promise.all([
    db.user.findMany({
      where: { role: "PARTNER" },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        isActive: true,
        partnerType: true,
        partnerManager: { select: { name: true } },
      },
    }),
    db.lead.groupBy({
      by: ["createdById", "kind"],
      where: {
        createdBy: { role: "PARTNER" },
        ...(hasRange ? { createdAt: created } : {}),
      },
      _count: { _all: true },
    }),
    db.lead.findMany({
      where: {
        createdBy: { role: "PARTNER" },
        saleRecordId: { not: null },
        ...(hasRange ? { saleRecord: { soldAt: created } } : {}),
      },
      select: {
        createdById: true,
        saleRecord: { select: { price: true, returnedAmount: true, currency: true, returnedAt: true } },
      },
    }),
  ]);

  const rows = new Map<string, PartnerSummaryRow>(
    partners.map((p) => [
      p.id,
      {
        partnerId: p.id,
        name: p.isActive ? p.name : `${p.name} (отключён)`,
        type: p.partnerType,
        managerName: p.partnerManager?.name ?? null,
        requests: 0,
        interests: 0,
        sales: 0,
        amountUzs: 0,
        amountUsd: 0,
      },
    ]),
  );
  for (const c of counts) {
    const r = c.createdById ? rows.get(c.createdById) : undefined;
    if (!r) continue;
    if (c.kind === "REQUEST") r.requests += c._count._all;
    else r.interests += c._count._all;
  }
  for (const s of sold) {
    const r = s.createdById ? rows.get(s.createdById) : undefined;
    const sr = s.saleRecord;
    // Полностью возвращённая продажа не считается (как в «Сводке»).
    if (!r || !sr || sr.returnedAt) continue;
    r.sales += 1;
    // Чистая сумма — за вычетом частичных возвратов (sale-net, целые копейки).
    const net = Number(netDecStr(sr.price, sr.returnedAmount, 2) ?? 0);
    if (sr.currency === "USD") r.amountUsd = round2(r.amountUsd + net);
    else r.amountUzs = round2(r.amountUzs + net);
  }
  return [...rows.values()];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Вид камня продажи (через плиту / кусок / партию / узор). */
export async function saleStoneTypeId(
  db: Pick<PrismaClient, "saleRecord">,
  saleId: string,
): Promise<string | null> {
  const s = await db.saleRecord.findUnique({
    where: { id: saleId },
    select: {
      slab: { select: { stoneTypeId: true } },
      piece: { select: { stoneTypeId: true } },
      batch: { select: { stoneTypeId: true } },
      batchPattern: { select: { batch: { select: { stoneTypeId: true } } } },
    },
  });
  if (!s) return null;
  return (
    s.slab?.stoneTypeId ??
    s.piece?.stoneTypeId ??
    s.batch?.stoneTypeId ??
    s.batchPattern?.batch.stoneTypeId ??
    null
  );
}
