// ТЗ №20 D (§5) — напоминания о долгах сотрудникам Onyx через Telegram-бот.
//
// Клиентам ничего не уходит (раздел 14) — только менеджеру продажи и владельцу.
//
//   • За 1 день до срока           → менеджер продажи: «Завтра срок: …»
//   • Просрочка на 1-й / 7-й / 30-й → менеджер + владелец(ы): «Просрочено N …»
//   • Ежедневная сводка 09:00 Ташкент (cron 04:00 UTC) → владелец(ы)
//   • Долг без срока: напоминаний нет, только строка «Без срока» в сводке.
//
// Сумма везде — ОСТАТОК (amount − repaidAmount): частично погашенный долг
// напоминает только о том, что ещё не внесено. Сум и $ никогда не складываются.
//
// Идемпотентность (cron может опоздать или сработать дважды):
//   • Debt.remindedDueAt = dueDate, для которого «завтра» уже отправлено.
//     Если срок потом перенесли — значения не совпадут и напомним о новом сроке.
//   • Debt.overdueRemindDay = последний отправленный порог (0/1/7/30).
//     Отправляем только наивысший достигнутый порог, если он > записанного —
//     пропущенный день 1 при запуске на 3-й день уходит ОДНИМ сообщением.
//     Если срок перенесли в будущее (долг больше не просрочен) — сбрасываем в 0.
//   • Перед отправкой порог «захватывается» условным UPDATE (compare-and-set):
//     второй параллельный запуск получит count = 0 и ничего не пошлёт.
//     Если НИ ОДНО сообщение не ушло из-за ошибки Telegram — захват откатываем,
//     следующий запуск попробует снова (ничего не теряется).
//   • Сводка — одна в сутки: ключ AppConfig `debt-reminders.summary-ymd`.
//
// Сотрудник без Telegram (telegramId = null) просто не получает сообщение —
// без ошибок. Ошибка отправки одному адресату логируется и не мешает остальным.
//
// Логика не трогает prisma напрямую — только через ReminderStore, чтобы её
// можно было проверить в unit-тестах (src/tests/debt-reminders.test.ts).

import type { Currency, PrismaClient } from "@prisma/client";
import { tashkentYmd } from "@/lib/debts";
import { debtRemainingCents, formatMoneyCents } from "@/lib/payments";
import type { SendResult } from "@/lib/telegram";

// ───────────────────────── Типы ─────────────────────────

export interface ReminderPerson {
  id: string;
  name: string;
  telegramId: string | null;
  isActive?: boolean;
}

/** Активный долг со всем, что нужно для текста. */
export interface ReminderDebt {
  id: string;
  amount: { toString(): string };
  repaidAmount: { toString(): string } | null;
  currency: Currency;
  dueDate: Date | null;
  remindedDueAt: Date | null;
  overdueRemindDay: number;
  customerName: string;
  /** Карточка клиента долга (старые долги могут быть без неё). */
  clientId?: string | null;
  soldAt: Date;
  manager: ReminderPerson | null;
}

export interface ReminderStore {
  /** Только status = ACTIVE (вернувшиеся продажи — CANCELLED, сюда не попадут). */
  loadActiveDebts(): Promise<ReminderDebt[]>;
  /** Активные владельцы (с Telegram или без). */
  loadOwners(): Promise<ReminderPerson[]>;
  /** CAS: remindedDueAt ≠ dueDate → dueDate. true = захватили мы. */
  claimTomorrow(debtId: string, dueDate: Date): Promise<boolean>;
  /** Откат захвата «завтра» (все отправки упали). */
  releaseTomorrow(debtId: string, dueDate: Date, prev: Date | null): Promise<void>;
  /** CAS: overdueRemindDay from → to. true = захватили мы. */
  setOverdueDay(debtId: string, from: number, to: number): Promise<boolean>;
  /** CAS сводки за день ymd (YYYY-MM-DD по Ташкенту). true = ещё не отправляли. */
  claimSummary(ymd: string): Promise<boolean>;
  /** Откат захвата сводки. */
  releaseSummary(ymd: string): Promise<void>;
}

export type SendFn = (chatId: string, text: string) => Promise<SendResult>;

export interface DebtReminderDeps {
  store: ReminderStore;
  sendMessage: SendFn;
  now: Date;
  /** База абсолютной ссылки, без хвостового «/». */
  baseUrl: string;
}

export interface DebtReminderStats {
  tomorrowSent: number;
  overdueSent: number;
  overdueReset: number;
  summarySent: boolean;
  /** Сообщений, которые некому было отправить (сотрудник без Telegram). */
  skippedUnlinked: number;
  /** Ошибок отправки Telegram. */
  failed: number;
}

/** Пороги повторной просрочки (§5): не каждый день, а 1-й, 7-й и 30-й. */
export const OVERDUE_MILESTONES = [1, 7, 30] as const;

const SUMMARY_KEY = "debt-reminders.summary-ymd";
const TOP_N = 5;

// ───────────────────────── Даты (Ташкент) ─────────────────────────

/** Разница календарных дней b − a (обе YYYY-MM-DD). */
export function ymdDiffDays(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Сколько ташкентских календарных дней прошло после срока.
 * dueDate хранится как конец дня срока (23:59:59.999+05:00), поэтому
 * в сам день срока = 0, на следующий день = 1, за день до срока = −1.
 */
export function daysPastDue(dueDate: Date, now: Date): number {
  return ymdDiffDays(tashkentYmd(dueDate), tashkentYmd(now));
}

/** Наивысший достигнутый порог для N дней просрочки (0 — не просрочен). */
export function reachedMilestone(days: number): number {
  let m = 0;
  for (const x of OVERDUE_MILESTONES) if (days >= x) m = x;
  return m;
}

/** «21.10» — день.месяц по Ташкенту. */
function ddmm(d: Date): string {
  const [, mm, dd] = tashkentYmd(d).split("-");
  return `${dd}.${mm}`;
}

/** 1 день / 2 дня / 5 дней. */
export function pluralDays(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} день`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

// ───────────────────────── Тексты ─────────────────────────

/**
 * Ссылка на долг. Есть карточка клиента — «Платёж клиента» в валюте долга:
 * её открывают и владелец, и менеджер (по своим продажам), а «Должники» —
 * только владелец. Иначе — «Должники» с фильтром по клиенту + якорь `#debt-<id>`.
 */
export function debtLink(
  baseUrl: string,
  d: Pick<ReminderDebt, "id" | "customerName" | "clientId" | "currency">,
): string {
  if (d.clientId) {
    return `${baseUrl}/dolzhniki/klient/${encodeURIComponent(d.clientId)}?currency=${d.currency}`;
  }
  const q = encodeURIComponent(d.customerName);
  return `${baseUrl}/dolzhniki?q=${q}#debt-${d.id}`;
}

export function tomorrowText(d: ReminderDebt, baseUrl: string): string {
  const money = formatMoneyCents(debtRemainingCents(d), d.currency);
  return [
    `Завтра срок: ${d.customerName}, ${money}, продажа ${ddmm(d.soldAt)}`,
    debtLink(baseUrl, d),
  ].join("\n");
}

export function overdueText(d: ReminderDebt, days: number, baseUrl: string): string {
  const money = formatMoneyCents(debtRemainingCents(d), d.currency);
  const lines = [`Просрочено ${pluralDays(days)}: ${d.customerName}, ${money}`];
  const extra = [`продажа ${ddmm(d.soldAt)}`];
  if (d.manager) extra.push(`менеджер ${d.manager.name}`);
  lines.push(extra.join(" · "));
  lines.push(debtLink(baseUrl, d));
  return lines.join("\n");
}

interface CurrencyTotal {
  currency: Currency;
  count: number;
  cents: number;
}

/** Суммы по валютам — отдельно, порядок: сум, затем $. */
function totalsByCurrency(debts: ReminderDebt[]): CurrencyTotal[] {
  const order: Currency[] = ["UZS", "USD"];
  return order
    .map((currency) => {
      const xs = debts.filter((d) => d.currency === currency);
      return {
        currency,
        count: xs.length,
        cents: xs.reduce((s, d) => s + debtRemainingCents(d), 0),
      };
    })
    .filter((t) => t.count > 0);
}

function totalsLine(ts: CurrencyTotal[]): string {
  return ts.map((t) => formatMoneyCents(t.cents, t.currency)).join(" · ");
}

/**
 * Ежедневная сводка владельцу. Топ-5 — внутри каждой валюты (сум и $ нельзя
 * сравнивать без курса). Долги без срока — отдельной строкой «Без срока».
 */
export function summaryText(debts: ReminderDebt[], now: Date, baseUrl: string): string {
  const withRemaining = debts.filter((d) => debtRemainingCents(d) > 0);
  const overdue = withRemaining.filter(
    (d) => d.dueDate != null && daysPastDue(d.dueDate, now) >= 1,
  );
  const noDue = withRemaining.filter((d) => d.dueDate == null);

  const lines: string[] = [`Долги на ${ddmm(now)}`];
  if (overdue.length === 0) {
    lines.push("Просроченных долгов нет.");
  } else {
    const totals = totalsByCurrency(overdue);
    lines.push(`Просрочено: ${overdue.length}`);
    lines.push(`Сумма: ${totalsLine(totals)}`);
    for (const t of totals) {
      const top = overdue
        .filter((d) => d.currency === t.currency)
        .sort((a, b) => debtRemainingCents(b) - debtRemainingCents(a))
        .slice(0, TOP_N);
      lines.push("");
      lines.push(`Топ-${TOP_N} (${t.currency === "USD" ? "$" : "сум"}):`);
      top.forEach((d, i) => {
        const days = daysPastDue(d.dueDate as Date, now);
        lines.push(
          `${i + 1}. ${d.customerName} — ${formatMoneyCents(debtRemainingCents(d), d.currency)}, ${pluralDays(days)}`,
        );
      });
    }
  }
  if (noDue.length > 0) {
    lines.push("");
    lines.push(
      `Без срока: ${noDue.length} — ${totalsLine(totalsByCurrency(noDue))} (напоминаний по ним нет)`,
    );
  }
  lines.push("");
  lines.push(`${baseUrl}/dolzhniki${overdue.length > 0 ? "?overdue=1" : ""}`);
  return lines.join("\n");
}

// ───────────────────────── Отправка ─────────────────────────

interface Delivery {
  sent: number;
  failed: number;
  skippedUnlinked: number;
}

/**
 * Шлёт текст списку сотрудников. Дубликаты по telegramId (владелец сам продал)
 * — один раз. Неактивные и непривязанные пропускаются молча. Исключения
 * sendMessage ловятся — один сбой не мешает остальным.
 */
async function deliver(
  people: (ReminderPerson | null)[],
  text: string,
  send: SendFn,
  tag: string,
): Promise<Delivery> {
  const out: Delivery = { sent: 0, failed: 0, skippedUnlinked: 0 };
  const seen = new Set<string>();
  for (const p of people) {
    if (!p || p.isActive === false) continue;
    if (!p.telegramId) {
      out.skippedUnlinked += 1;
      continue;
    }
    if (seen.has(p.telegramId)) continue;
    seen.add(p.telegramId);
    try {
      const r = await send(p.telegramId, text);
      if (r.ok) out.sent += 1;
      else {
        out.failed += 1;
        console.warn(`[debt-reminders] ${tag}: не отправлено ${p.name}: ${r.error}`);
      }
    } catch (e) {
      out.failed += 1;
      console.warn(
        `[debt-reminders] ${tag}: ошибка отправки ${p.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return out;
}

/** Все попытки упали (а пытались хоть кому-то) — захват надо откатить. */
function allFailed(d: Delivery): boolean {
  return d.sent === 0 && d.failed > 0;
}

// ───────────────────────── Основной проход ─────────────────────────

export async function runDebtReminders(deps: DebtReminderDeps): Promise<DebtReminderStats> {
  const { store, sendMessage: send, now, baseUrl } = deps;
  const stats: DebtReminderStats = {
    tomorrowSent: 0,
    overdueSent: 0,
    overdueReset: 0,
    summarySent: false,
    skippedUnlinked: 0,
    failed: 0,
  };
  const add = (d: Delivery) => {
    stats.skippedUnlinked += d.skippedUnlinked;
    stats.failed += d.failed;
  };

  const [debts, owners] = await Promise.all([store.loadActiveDebts(), store.loadOwners()]);
  const open = debts.filter((d) => debtRemainingCents(d) > 0);

  for (const d of open) {
    if (d.dueDate == null) continue; // без срока — только в сводке
    try {
      const days = daysPastDue(d.dueDate, now);

      // Срок перенесли в будущее после напоминаний о просрочке — счёт заново.
      if (days < 1 && d.overdueRemindDay > 0) {
        if (await store.setOverdueDay(d.id, d.overdueRemindDay, 0)) stats.overdueReset += 1;
      }

      // «Завтра срок» — только менеджеру продажи, один раз на конкретный dueDate.
      if (days === -1) {
        const already =
          d.remindedDueAt != null && d.remindedDueAt.getTime() === d.dueDate.getTime();
        if (!already && (await store.claimTomorrow(d.id, d.dueDate))) {
          const r = await deliver([d.manager], tomorrowText(d, baseUrl), send, "завтра");
          add(r);
          if (allFailed(r)) await store.releaseTomorrow(d.id, d.dueDate, d.remindedDueAt);
          else stats.tomorrowSent += r.sent;
        }
        continue;
      }

      // Просрочка: наивысший достигнутый порог, если он ещё не отправлен.
      const milestone = reachedMilestone(days);
      if (milestone > d.overdueRemindDay) {
        if (await store.setOverdueDay(d.id, d.overdueRemindDay, milestone)) {
          const r = await deliver(
            [d.manager, ...owners],
            overdueText(d, days, baseUrl),
            send,
            "просрочка",
          );
          add(r);
          if (allFailed(r)) await store.setOverdueDay(d.id, milestone, d.overdueRemindDay);
          else stats.overdueSent += r.sent;
        }
      }
    } catch (e) {
      // Сбой по одному долгу не должен остановить остальные.
      console.warn(
        `[debt-reminders] долг ${d.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Ежедневная сводка владельцу — одна в ташкентские сутки.
  try {
    const ymd = tashkentYmd(now);
    if (owners.some((o) => o.isActive !== false && o.telegramId)) {
      if (await store.claimSummary(ymd)) {
        const r = await deliver(owners, summaryText(open, now, baseUrl), send, "сводка");
        add(r);
        if (allFailed(r)) await store.releaseSummary(ymd);
        else stats.summarySent = r.sent > 0;
      }
    } else {
      stats.skippedUnlinked += owners.length;
    }
  } catch (e) {
    console.warn(`[debt-reminders] сводка: ${e instanceof Error ? e.message : String(e)}`);
  }

  return stats;
}

// ───────────────────────── Prisma-адаптер ─────────────────────────

/** Хранилище на Prisma: все «захваты» — условный updateMany (compare-and-set). */
export function prismaReminderStore(db: PrismaClient): ReminderStore {
  return {
    async loadActiveDebts() {
      const rows = await db.debt.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          amount: true,
          repaidAmount: true,
          currency: true,
          dueDate: true,
          remindedDueAt: true,
          overdueRemindDay: true,
          clientId: true,
          saleRecord: {
            select: {
              customerName: true,
              soldAt: true,
              manager: { select: { id: true, name: true, telegramId: true, isActive: true } },
            },
          },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        repaidAmount: r.repaidAmount,
        currency: r.currency,
        dueDate: r.dueDate,
        remindedDueAt: r.remindedDueAt,
        overdueRemindDay: r.overdueRemindDay,
        customerName: r.saleRecord.customerName,
        clientId: r.clientId,
        soldAt: r.saleRecord.soldAt,
        manager: r.saleRecord.manager,
      }));
    },
    async loadOwners() {
      return db.user.findMany({
        where: { role: "OWNER", isActive: true },
        select: { id: true, name: true, telegramId: true, isActive: true },
      });
    },
    async claimTomorrow(debtId, dueDate) {
      const r = await db.debt.updateMany({
        where: {
          id: debtId,
          status: "ACTIVE",
          dueDate,
          OR: [{ remindedDueAt: null }, { remindedDueAt: { not: dueDate } }],
        },
        data: { remindedDueAt: dueDate },
      });
      return r.count === 1;
    },
    async releaseTomorrow(debtId, dueDate, prev) {
      await db.debt.updateMany({
        where: { id: debtId, remindedDueAt: dueDate },
        data: { remindedDueAt: prev },
      });
    },
    async setOverdueDay(debtId, from, to) {
      const r = await db.debt.updateMany({
        where: { id: debtId, status: "ACTIVE", overdueRemindDay: from },
        data: { overdueRemindDay: to },
      });
      return r.count === 1;
    },
    async claimSummary(ymd) {
      const r = await db.appConfig.updateMany({
        where: { key: SUMMARY_KEY, NOT: { value: ymd } },
        data: { value: ymd },
      });
      if (r.count === 1) return true;
      const existing = await db.appConfig.findUnique({ where: { key: SUMMARY_KEY } });
      if (existing) return false; // уже = ymd
      try {
        await db.appConfig.create({ data: { key: SUMMARY_KEY, value: ymd } });
        return true;
      } catch {
        return false; // параллельный запуск создал раньше
      }
    },
    async releaseSummary(ymd) {
      await db.appConfig.deleteMany({ where: { key: SUMMARY_KEY, value: ymd } });
    },
  };
}
