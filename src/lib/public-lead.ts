// ТЗ №20 H (§9.2) — заявка клиента с карточки по QR (без входа).
//
// Форма: имя *, телефон *, комментарий; камень подставляется сам (код в ссылке).
// Заявка → существующие «Заявки» (Lead) с source = QR_CATALOG, статус «Новая»,
// createdById = NULL (клиента в системе нет). Клиента НЕ создаём: если телефон
// уже есть в «Клиентах» — только привязка clientId.
//
// Защита от спама (все три правила — до записи):
//   1. скрытое поле-ловушка (honeypot) заполнено → делаем вид, что всё ушло,
//      ничего не пишем и никого не будим;
//   2. не больше 10 заявок с одного IP в час — счётчик в той же таблице, что
//      троттлинг входа (LoginAttempt, scope «lead_ip», окно 1 час, та же чистая
//      логика decideThrottle/nextFailureState). Таблица вне бэкапа (служебная)
//      и чистится той же ленивой очисткой;
//   3. одна заявка с телефона на камень в сутки (день по Ташкенту): колонка
//      Lead.dedupeKey = «цифры телефона|вид|YYYY-MM-DD» с UNIQUE-индексом —
//      две одновременные отправки не пройдут обе (вторая получит P2002).
//
// Уведомление: всем активным менеджерам и владельцу с привязанным Telegram —
// «Новая заявка: Травертин Классик ONX-7K3QD, Азиз +998…» + кнопка
// «Менеджер связался». Первый нажавший становится ответственным: условный
// UPDATE … WHERE status = 'NEW' AND assignedManagerId IS NULL — победитель
// ровно один, остальным бот отвечает «уже взял …».
//
// Модуль: чистые правила (тестируются без БД) + тонкие функции с db параметром.

import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeClientPhone } from "./clients";
import { todayTashkentISO } from "./datetime";
import { decideThrottle, nextFailureState, type AttemptRow } from "./login-throttle";
import { findByCode } from "./stone-code";
import type {
  SendMessageOptions,
  SendResult,
  TgCallbackQuery,
  TgInlineKeyboardMarkup,
} from "./telegram";

// ───────────────────────── Правила ─────────────────────────

/** Имя скрытого поля-ловушки (люди его не видят, боты заполняют). */
export const PUBLIC_LEAD_HONEYPOT_FIELD = "website";

export const PUBLIC_LEAD_IP_SCOPE = "lead_ip";
export const PUBLIC_LEAD_IP_LIMIT = 10;
export const PUBLIC_LEAD_IP_WINDOW_MS = 60 * 60 * 1000;

export const PUBLIC_LEAD_NAME_MAX = 80;
export const PUBLIC_LEAD_COMMENT_MAX = 1000;
/** Телефон: 9 цифр (90 123 45 67) … 15 (E.164). */
const PHONE_MIN_DIGITS = 9;
const PHONE_MAX_DIGITS = 15;

export type PublicLeadFieldError = "name" | "phone" | "phoneInvalid";

export interface PublicLeadInput {
  name: string;
  phone: string;
  phoneKey: string;
  comment: string | null;
}

export type ParsedPublicLead =
  | { kind: "ok"; value: PublicLeadInput }
  | { kind: "bot" }
  | { kind: "invalid"; errors: Partial<Record<"name" | "phone", PublicLeadFieldError>> };

/** Разбор формы. Ловушка проверяется первой — боту не подсказываем, что не так. */
export function parsePublicLeadForm(raw: {
  name?: unknown;
  phone?: unknown;
  comment?: unknown;
  honeypot?: unknown;
}): ParsedPublicLead {
  const trap = typeof raw.honeypot === "string" ? raw.honeypot.trim() : "";
  if (trap !== "") return { kind: "bot" };

  const name = (typeof raw.name === "string" ? raw.name : "").trim().replace(/\s+/g, " ");
  const phone = (typeof raw.phone === "string" ? raw.phone : "").trim();
  const commentRaw = (typeof raw.comment === "string" ? raw.comment : "").trim();
  const phoneKey = normalizeClientPhone(phone);

  const errors: Partial<Record<"name" | "phone", PublicLeadFieldError>> = {};
  if (name === "") errors.name = "name";
  if (phone === "") errors.phone = "phone";
  else if (phoneKey.length < PHONE_MIN_DIGITS || phoneKey.length > PHONE_MAX_DIGITS) {
    errors.phone = "phoneInvalid";
  }
  if (errors.name || errors.phone) return { kind: "invalid", errors };

  return {
    kind: "ok",
    value: {
      name: name.slice(0, PUBLIC_LEAD_NAME_MAX),
      phone: phone.slice(0, 40),
      phoneKey,
      comment: commentRaw ? commentRaw.slice(0, PUBLIC_LEAD_COMMENT_MAX) : null,
    },
  };
}

/**
 * Ключ «одна заявка с телефона на камень в сутки». Камень — ВИД (код партии и
 * код узора того же вида считаются одним камнем: клиент тот же, интерес тот же).
 * Сутки — календарный день по Ташкенту, не «24 часа с прошлой заявки».
 */
export function leadDedupeKey(phoneKey: string, stoneTypeId: string, now: Date): string {
  return `${phoneKey}|${stoneTypeId}|${todayTashkentISO(now)}`;
}

/** IP-лимит: тот же скользящий-от-первой-попытки счётчик, что у входа. */
export function decideLeadIpLimit(row: AttemptRow | null, now: Date) {
  return decideThrottle({
    row,
    now,
    limit: PUBLIC_LEAD_IP_LIMIT,
    windowMs: PUBLIC_LEAD_IP_WINDOW_MS,
  });
}

/** Варианты ключа телефона для сверки с «Клиентами»: 998XXXXXXXXX ⇄ XXXXXXXXX. */
export function phoneKeyVariants(phoneKey: string): string[] {
  const out = new Set<string>([phoneKey]);
  if (phoneKey.length === 12 && phoneKey.startsWith("998")) out.add(phoneKey.slice(3));
  if (phoneKey.length === 9) out.add(`998${phoneKey}`);
  return [...out];
}

// ───────────────────────── Telegram: текст и кнопка ─────────────────────────

const CLAIM_PREFIX = "lc:";

export function leadClaimCallbackData(leadId: string): string {
  return `${CLAIM_PREFIX}${leadId}`;
}

/** callback_data → id заявки или null (чужая кнопка). */
export function parseLeadClaimCallbackData(data: string | null | undefined): string | null {
  if (typeof data !== "string" || !data.startsWith(CLAIM_PREFIX)) return null;
  const id = data.slice(CLAIM_PREFIX.length).trim();
  return /^[a-z0-9_-]{1,60}$/i.test(id) ? id : null;
}

export const LEAD_CLAIM_BUTTON = "Менеджер связался";

export function leadClaimKeyboard(leadId: string): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: LEAD_CLAIM_BUTTON, callback_data: leadClaimCallbackData(leadId) }]],
  };
}

/** «Новая заявка: Травертин Классик ONX-7K3QD, Азиз +998 90 123 45 67» (+ комментарий). */
export function formatLeadNotification(args: {
  stoneName: string;
  code: string;
  clientName: string;
  phone: string;
  comment: string | null;
  knownClientName?: string | null;
  /** ТЗ №20 I — заявка со страницы подборки. */
  collectionTitle?: string | null;
}): string {
  const lines = [
    `Новая заявка: ${args.stoneName} ${args.code}, ${args.clientName} ${args.phone}`,
  ];
  if (args.collectionTitle) lines.push(`Из подборки: «${args.collectionTitle}»`);
  if (args.knownClientName) lines.push(`Есть в «Клиентах»: ${args.knownClientName}`);
  if (args.comment) lines.push(`Комментарий: ${args.comment}`);
  lines.push("Источник: QR / каталог");
  return lines.join("\n");
}

// ───────────────────────── БД: создание заявки ─────────────────────────

export type PublicLeadResult =
  | { status: "ok"; leadId: string | null }
  | { status: "invalid"; errors: Partial<Record<"name" | "phone", PublicLeadFieldError>> }
  | { status: "notfound" }
  | { status: "duplicate" }
  | { status: "rate" };

type LeadDb = Pick<
  PrismaClient,
  | "stoneType"
  | "batch"
  | "batchPattern"
  | "slab"
  | "piece"
  | "lead"
  | "loginAttempt"
  | "user"
  | "$transaction"
  | "$queryRaw"
>;

export interface PublicLeadDeps {
  /** Telegram (route/action передаёт sendMessage). Тесты — mock. */
  send: (chatId: string, text: string, opts?: SendMessageOptions) => Promise<SendResult>;
}

/** id клиента с тем же телефоном (цифры, с/без 998) или null. Клиента не создаёт. */
export async function findClientIdByPhone(
  db: Pick<PrismaClient, "$queryRaw">,
  phoneKey: string,
): Promise<{ id: string; name: string } | null> {
  if (!phoneKey) return null;
  const variants = phoneKeyVariants(phoneKey);
  const rows = await db.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name" FROM "Client"
    WHERE regexp_replace("phone", '\\D', '', 'g') = ANY(${variants})
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function bumpIpCounter(db: LeadDb, ip: string, row: AttemptRow | null, now: Date) {
  const next = nextFailureState({ row, now, windowMs: PUBLIC_LEAD_IP_WINDOW_MS });
  await db.loginAttempt.upsert({
    where: { scope_key: { scope: PUBLIC_LEAD_IP_SCOPE, key: ip } },
    create: {
      scope: PUBLIC_LEAD_IP_SCOPE,
      key: ip,
      failures: next.failures,
      firstAt: next.firstAt,
      lastAt: now,
    },
    update: { failures: next.failures, firstAt: next.firstAt, lastAt: now },
  });
}

/**
 * Принять заявку с карточки. Никогда не бросает на пользовательском вводе —
 * возвращает статус для экрана. Telegram — после коммита, сбой отправки
 * заявку не отменяет.
 */
export async function submitPublicLead(
  db: LeadDb,
  input: {
    code: string;
    form: { name?: unknown; phone?: unknown; comment?: unknown; honeypot?: unknown };
    ip: string;
    now?: Date;
    /**
     * ТЗ №20 I (§10.3) — заявка со страницы подборки /podborka/<код>. Подборку
     * (открыта, камень в ней) проверяет вызывающий; здесь — пометка в
     * комментарии заявки, в «Истории» и в Telegram.
     */
    context?: { collectionCode: string; collectionTitle: string } | null;
  },
  deps: PublicLeadDeps,
): Promise<PublicLeadResult> {
  const now = input.now ?? new Date();
  const parsed = parsePublicLeadForm(input.form);
  // Ловушка: «успех» без записи — бот не узнаёт, что его поймали.
  if (parsed.kind === "bot") return { status: "ok", leadId: null };
  if (parsed.kind === "invalid") return { status: "invalid", errors: parsed.errors };
  const v = parsed.value;

  const hit = await findByCode(db, input.code);
  if (!hit) return { status: "notfound" };

  // IP: читаем счётчик; сбой таблицы — fail-open (как вход): остальные
  // правила (телефон/сутки) всё равно работают.
  let ipRow: AttemptRow | null = null;
  if (input.ip) {
    try {
      ipRow = await db.loginAttempt.findUnique({
        where: { scope_key: { scope: PUBLIC_LEAD_IP_SCOPE, key: input.ip } },
        select: { failures: true, firstAt: true },
      });
    } catch (e) {
      console.warn("[public-lead] IP-счётчик недоступен — пропускаем:", e);
    }
    if (decideLeadIpLimit(ipRow, now).blocked) return { status: "rate" };
  }

  const dedupeKey = leadDedupeKey(v.phoneKey, hit.stoneTypeId, now);
  const already = await db.lead.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (already) return { status: "duplicate" };

  if (input.ip) {
    try {
      await bumpIpCounter(db, input.ip, ipRow, now);
    } catch (e) {
      console.warn("[public-lead] IP-счётчик не записан:", e);
    }
  }

  const [stone, client] = await Promise.all([
    db.stoneType.findUnique({ where: { id: hit.stoneTypeId }, select: { name: true } }),
    findClientIdByPhone(db, v.phoneKey).catch(() => null),
  ]);
  const stoneName = stone?.name ?? "Камень";
  const ctx = input.context ?? null;
  // В «Заявках» видно, откуда пришла: «Подборка «…» (/podborka/КОД)».
  const note = ctx
    ? [`Подборка «${ctx.collectionTitle}» (/podborka/${ctx.collectionCode})`, v.comment]
        .filter(Boolean)
        .join("\n")
        .slice(0, PUBLIC_LEAD_COMMENT_MAX + 200)
    : v.comment;

  let leadId: string;
  try {
    leadId = await db.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          createdById: null,
          source: "QR_CATALOG",
          kind: "REQUEST",
          status: "NEW",
          stoneTypeId: hit.stoneTypeId,
          stoneCode: hit.code,
          clientName: v.name,
          clientPhone: v.phone,
          phoneKey: v.phoneKey,
          clientId: client?.id ?? null,
          contact: v.phone,
          note,
          dedupeKey,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: null,
          action: "STATUS_CHANGE",
          entityType: "Lead",
          entityId: lead.id,
          payload: {
            kind: "lead.qr_create",
            from: null,
            to: "NEW",
            stoneName,
            code: hit.code,
            clientName: v.name,
            clientId: client?.id ?? null,
            collectionCode: ctx?.collectionCode ?? null,
            collectionTitle: ctx?.collectionTitle ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      return lead.id;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { status: "duplicate" };
    }
    throw e;
  }

  await notifyLeadSafe(db, deps, {
    leadId,
    text: formatLeadNotification({
      stoneName,
      code: hit.code,
      clientName: v.name,
      phone: v.phone,
      comment: v.comment,
      knownClientName: client?.name ?? null,
      collectionTitle: ctx?.collectionTitle ?? null,
    }),
  });
  return { status: "ok", leadId };
}

/** Всем активным OWNER/MANAGER с Telegram. Ошибки только в лог. */
async function notifyLeadSafe(
  db: Pick<PrismaClient, "user">,
  deps: PublicLeadDeps,
  msg: { leadId: string; text: string },
): Promise<number> {
  try {
    const users = await db.user.findMany({
      where: {
        isActive: true,
        role: { in: ["OWNER", "MANAGER"] },
        telegramId: { not: null },
      },
      select: { telegramId: true },
    });
    const keyboard = leadClaimKeyboard(msg.leadId);
    const results = await Promise.allSettled(
      users.map((u) => deps.send(u.telegramId!, msg.text, { reply_markup: keyboard })),
    );
    return results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  } catch (e) {
    console.warn("[public-lead] уведомление не отправлено:", e);
    return 0;
  }
}

// ───────────────────────── «Менеджер связался» ─────────────────────────

export type LeadClaimResult =
  | { status: "claimed"; managerName: string }
  | { status: "taken"; managerName: string | null }
  | { status: "denied" }
  | { status: "notfound" };

type ClaimDb = Pick<PrismaClient, "user" | "lead" | "$transaction">;

/**
 * Первый нажавший становится ответственным. Атомарно: updateMany с условием
 * «ещё NEW и без ответственного» — из двух одновременных нажатий count = 1
 * получит ровно одно. Нажать могут только активные OWNER/MANAGER, чей
 * Telegram привязан (кнопка могла уйти в пересланное сообщение).
 */
export async function claimLeadFromTelegram(
  db: ClaimDb,
  args: { leadId: string; telegramUserId: number | string },
): Promise<LeadClaimResult> {
  const me = await db.user.findFirst({
    where: { telegramId: String(args.telegramUserId), isActive: true },
    select: { id: true, name: true, role: true },
  });
  if (!me || (me.role !== "OWNER" && me.role !== "MANAGER")) return { status: "denied" };

  const won = await db.$transaction(async (tx) => {
    const res = await tx.lead.updateMany({
      where: { id: args.leadId, status: "NEW", assignedManagerId: null },
      data: { status: "CONTACTED", assignedManagerId: me.id },
    });
    if (res.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        userId: me.id,
        action: "STATUS_CHANGE",
        entityType: "Lead",
        entityId: args.leadId,
        payload: {
          kind: "lead.claim",
          from: "NEW",
          to: "CONTACTED",
          via: "telegram",
          managerName: me.name,
        } as Prisma.InputJsonValue,
      },
    });
    return true;
  });
  if (won) return { status: "claimed", managerName: me.name };

  const lead = await db.lead.findUnique({
    where: { id: args.leadId },
    select: { id: true, assignedManager: { select: { name: true } } },
  });
  if (!lead) return { status: "notfound" };
  return { status: "taken", managerName: lead.assignedManager?.name ?? null };
}

export interface LeadCallbackDeps {
  db: ClaimDb;
  answer: (callbackQueryId: string, text: string, showAlert?: boolean) => Promise<unknown>;
  edit: (chatId: number, messageId: number, text: string) => Promise<unknown>;
}

/** Текст под сообщением после решения (кнопка снимается). */
export function claimedFooter(managerName: string | null): string {
  return managerName ? `Взял(а): ${managerName}` : "Заявку уже взяли в работу";
}

/**
 * Нажатие кнопки под уведомлением. true — это была наша кнопка (обработано),
 * false — чужая (вызывающий решает сам). Никогда не бросает.
 */
export async function handleLeadClaimCallback(
  cq: TgCallbackQuery,
  deps: LeadCallbackDeps,
): Promise<boolean> {
  const leadId = parseLeadClaimCallbackData(cq.data);
  if (!leadId) return false;
  try {
    const r = await claimLeadFromTelegram(deps.db, {
      leadId,
      telegramUserId: cq.from.id,
    });
    const msg = cq.message;
    const rewrite = async (footer: string) => {
      if (msg && typeof msg.text === "string") {
        await deps.edit(msg.chat.id, msg.message_id, `${msg.text}\n\n${footer}`);
      }
    };
    if (r.status === "claimed") {
      await deps.answer(cq.id, "Вы ответственный за заявку. Позвоните клиенту.");
      await rewrite(claimedFooter(r.managerName));
    } else if (r.status === "taken") {
      await deps.answer(
        cq.id,
        r.managerName ? `Заявку уже взял(а) ${r.managerName}.` : "Заявку уже взяли в работу.",
        true,
      );
      await rewrite(claimedFooter(r.managerName));
    } else if (r.status === "denied") {
      await deps.answer(cq.id, "Заявки берут менеджеры и владелец.", true);
    } else {
      await deps.answer(cq.id, "Заявка не найдена.", true);
    }
  } catch (e) {
    console.error("[public-lead] claim:", e);
    await Promise.resolve(deps.answer(cq.id, "Не удалось — попробуйте ещё раз.", true)).catch(
      () => undefined,
    );
  }
  return true;
}
