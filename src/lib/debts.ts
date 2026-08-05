// TZ №9 — domain layer for «Должники» (credit sales).
//
// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED API (binding for o2 / o3 — do not rename)
// ═══════════════════════════════════════════════════════════════════════════
//
// createDebtForSale(tx, {
//   saleRecordId: string,
//   amount: Decimal | string,   // sale price; Decimal preferred, never float math
//   currency: "UZS" | "USD",
//   dueDate?: Date | null,
//   comment?: string | null,
// }): Promise<{ debtId: string }>
//   → Call INSIDE the same $transaction that created the SaleRecord (CREDIT only).
//   → Throws DebtLogicError on validation / unique conflict.
//
// repayDebt(db, {
//   debtId: string,
//   actorId: string,
//   repaidAt: Date,            // inject now — do not Date.now() inside helpers
// }): Promise<
//   | { ok: true; debtId: string; status: "REPAID" }
//   | { ok: false; error: DebtError }
// >
//   → Full repayment only (partial later via repaidAmount room).
//   → Own transaction + AuditLog(STATUS_CHANGE).
//
// cancelDebtForReturnedSale(tx, {
//   saleRecordId: string,
//   actorId: string,
//   now: Date,
// }): Promise<CancelDebtResult>
//   → Call INSIDE returnSale's transaction after marking returnedAt.
//   → ACTIVE → CANCELLED. REPAID → left as REPAID (money was collected; see below).
//   → No debt row → no-op { outcome: "none" }.
//
// listDebts(db, {
//   status?: DebtStatus | "ALL",
//   q?: string,                 // client name/phone ILIKE
//   managerId?: string,
//   overdueOnly?: boolean,
//   currency?: Currency,
//   cursor?: string | null,     // Debt.id for keyset
//   pageSize?: number,          // default 30, max 100
//   now: Date,                  // for overdue classification
// }): Promise<{ items: DebtListItem[]; nextCursor: string | null }>
//
// debtSummary(db, { now: Date }): Promise<DebtSummary>
//   → Per-currency active / overdue totals. NEVER a single combined money figure.
//
// isDebtOverdue(debt, now): boolean  — pure; see dueDate policy below
// normalizeDebtDueDate(date): Date | null — store end of Asia/Tashkent day
//
// ── Design: REPAID + later return (QA scenario A) ──────────────────────────
// If the client already repaid and the sale is then returned: leave REPAID
// (outcome "left_repaid"). Do NOT re-open ACTIVE, do NOT create negative debt.
// ACTIVE → CANCELLED only. Cash refund is outside this module.
//
// ── dueDate / overdue timezone (QA #5) ─────────────────────────────────────
// Warehouse day is Asia/Tashkent (UTC+5, no DST) — same as datetime.ts.
// STORAGE: dueDate = end of that Tashkent calendar day
//          (YYYY-MM-DDT23:59:59.999+05:00) so "due 3 Aug" stays current all day.
// OVERDUE: status===ACTIVE && dueDate != null && now > dueDate
//          (strictly after end of due day in Tashkent).
// createDebtForSale always normalizes via normalizeDebtDueDate so callers that
// pass bare `T00:00:00` (sale-payment.ts legacy) still land on the correct day.
//
// Money is Decimal(14,2) matching SaleRecord.price (sale totals, not unit prices).
// Never Number() arithmetic on amounts. UZS and USD are never added together.

import type { Currency, DebtStatus, Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { APP_TZ } from "@/lib/datetime";
import { MAX_DECIMAL_14_2 } from "@/lib/decimal";

// ───────────────────────── Errors ─────────────────────────

export type DebtErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "ALREADY_REPAID"
  | "NOT_ACTIVE"
  | "FORBIDDEN";

export interface DebtError {
  code: DebtErrorCode;
  message: string;
}

/** Thrown inside a sale/return $transaction — caller maps to SaleFail if needed. */
export class DebtLogicError extends Error {
  constructor(public readonly debtError: DebtError) {
    super(debtError.message);
    this.name = "DebtLogicError";
  }
}

function fail(code: DebtErrorCode, message: string): DebtError {
  return { code, message };
}

// ───────────────────────── Types ─────────────────────────

export type DebtCurrency = Currency; // "UZS" | "USD"
export type DebtPaymentCurrency = Currency;

export interface CreateDebtForSaleInput {
  saleRecordId: string;
  /** Sale price as Decimal or decimal string (never float). */
  amount: Prisma.Decimal | string;
  currency: Currency;
  dueDate?: Date | null;
  comment?: string | null;
  /** TZ №10+11 — denormalized client link for client card (nullable). */
  clientId?: string | null;
}

export interface RepayDebtInput {
  debtId: string;
  actorId: string;
  /** Injected clock — boundary for repaidAt. */
  repaidAt: Date;
}

export type RepayDebtResult =
  | { ok: true; debtId: string; status: "REPAID" }
  | { ok: false; error: DebtError };

export interface CancelDebtForReturnedSaleInput {
  saleRecordId: string;
  actorId: string;
  now: Date;
}

export type CancelDebtOutcome =
  | "none" // no Debt row for this sale
  | "cancelled" // was ACTIVE → CANCELLED
  | "left_repaid" // was REPAID — preserved (money collected)
  | "already_cancelled";

export interface CancelDebtResult {
  outcome: CancelDebtOutcome;
  debtId: string | null;
}

export interface ListDebtsInput {
  status?: DebtStatus | "ALL";
  q?: string;
  managerId?: string;
  overdueOnly?: boolean;
  currency?: Currency;
  cursor?: string | null;
  pageSize?: number;
  now: Date;
}

export interface DebtListItem {
  id: string;
  saleRecordId: string;
  amount: string; // decimal string
  currency: Currency;
  status: DebtStatus;
  dueDate: Date | null;
  comment: string | null;
  repaidAt: Date | null;
  repaidAmount: string | null;
  createdAt: Date;
  overdue: boolean;
  sale: {
    customerName: string;
    customerContact: string | null;
    soldAt: Date;
    price: string | null;
    targetType: string;
    qtySlabs: number | null;
    qtyAreaM2: string | null;
    managerId: string;
    managerName: string;
  };
}

export interface CurrencyMoney {
  currency: Currency;
  /** Decimal string, never float. */
  amount: string;
  count: number;
}

export interface DebtSummary {
  /** Active debts totals — one entry per currency that has rows. */
  activeByCurrency: CurrencyMoney[];
  /** Overdue subset of active (dueDate < now). */
  overdueByCurrency: CurrencyMoney[];
  /** Distinct clients with at least one ACTIVE debt (all currencies). */
  activeDebtorCount: number;
}

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

// ───────────────────────── Pure helpers ─────────────────────────

const tashkentYmdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD of an instant in Asia/Tashkent. */
export function tashkentYmd(d: Date): string {
  return tashkentYmdFmt.format(d);
}

/**
 * End of a Tashkent calendar day as a UTC instant.
 * `ymd` must be YYYY-MM-DD (the due day the owner typed).
 */
export function endOfTashkentCalendarDay(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+05:00`);
}

/**
 * Normalize any dueDate for storage: map to end of that date's Tashkent day.
 * Accepts null. Injected Dates (including ambiguous `T00:00:00` from forms)
 * are re-read as Tashkent YMD then stored as that day's 23:59:59.999+05:00.
 */
export function normalizeDebtDueDate(
  dueDate: Date | null | undefined,
): Date | null {
  if (dueDate == null) return null;
  if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime())) {
    return null;
  }
  return endOfTashkentCalendarDay(tashkentYmd(dueDate));
}

/**
 * Overdue = ACTIVE + dueDate set + now is strictly after dueDate.
 * With end-of-Tashkent-day storage, the whole due calendar day is still OK;
 * after local midnight the debt is overdue. `now` is always injected.
 */
export function isDebtOverdue(
  debt: { status: DebtStatus; dueDate: Date | null },
  now: Date,
): boolean {
  if (debt.status !== "ACTIVE") return false;
  if (debt.dueDate == null) return false;
  return now.getTime() > debt.dueDate.getTime();
}

function toDecimal(amount: Prisma.Decimal | string): Prisma.Decimal {
  try {
    const d =
      typeof amount === "string"
        ? new PrismaNS.Decimal(amount)
        : amount;
    if (d.isNaN() || !d.isFinite() || d.lte(0)) {
      throw new DebtLogicError(
        fail("INVALID_INPUT", "Сумма долга — положительное число"),
      );
    }
    // Same cap as SaleRecord.price Decimal(14,2) / MAX_DECIMAL_14_2.
    if (d.gt(new PrismaNS.Decimal(String(MAX_DECIMAL_14_2)))) {
      throw new DebtLogicError(
        fail("INVALID_INPUT", "Сумма долга слишком велика"),
      );
    }
    return d.toDecimalPlaces(2);
  } catch (e) {
    if (e instanceof DebtLogicError) throw e;
    throw new DebtLogicError(
      fail("INVALID_INPUT", "Сумма долга — положительное число"),
    );
  }
}

function decimalString(d: Prisma.Decimal | { toString(): string } | null): string | null {
  if (d == null) return null;
  return d.toString();
}

// ───────────────────────── createDebtForSale ─────────────────────────

/**
 * Creates Debt for a CREDIT sale. Must run in the SAME transaction as
 * saleRecord.create. CASH/CARD callers must not invoke this.
 */
export async function createDebtForSale(
  tx: Prisma.TransactionClient,
  input: CreateDebtForSaleInput,
): Promise<{ debtId: string }> {
  const saleRecordId = input.saleRecordId?.trim();
  if (!saleRecordId) {
    throw new DebtLogicError(fail("INVALID_INPUT", "saleRecordId обязателен"));
  }
  if (input.currency !== "UZS" && input.currency !== "USD") {
    throw new DebtLogicError(fail("INVALID_INPUT", "Валюта — UZS или USD"));
  }
  const amount = toDecimal(input.amount);
  const comment = input.comment?.trim() || null;
  // QA #5 — always store end of Tashkent day, never bare local midnight.
  const dueDate = normalizeDebtDueDate(input.dueDate ?? null);

  try {
    const debt = await tx.debt.create({
      data: {
        saleRecordId,
        amount,
        currency: input.currency,
        status: "ACTIVE",
        dueDate,
        comment,
        clientId: input.clientId?.trim() || null,
      },
      select: { id: true },
    });
    return { debtId: debt.id };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2002") {
      throw new DebtLogicError(
        fail("INVALID_INPUT", "Долг по этой продаже уже существует"),
      );
    }
    if (code === "P2003") {
      throw new DebtLogicError(fail("NOT_FOUND", "Продажа для долга не найдена"));
    }
    throw e;
  }
}

// ───────────────────────── repayDebt ─────────────────────────

export async function repayDebt(
  db: PrismaClient | Prisma.TransactionClient,
  input: RepayDebtInput,
): Promise<RepayDebtResult> {
  const debtId = input.debtId?.trim();
  if (!debtId) {
    return { ok: false, error: fail("INVALID_INPUT", "debtId обязателен") };
  }
  if (!input.actorId?.trim()) {
    return { ok: false, error: fail("INVALID_INPUT", "actorId обязателен") };
  }
  if (!(input.repaidAt instanceof Date) || Number.isNaN(input.repaidAt.getTime())) {
    return { ok: false, error: fail("INVALID_INPUT", "repaidAt — корректная дата") };
  }

  const run = async (tx: Prisma.TransactionClient): Promise<RepayDebtResult> => {
    const debt = await tx.debt.findUnique({
      where: { id: debtId },
      select: { id: true, status: true, amount: true },
    });
    if (!debt) {
      return { ok: false, error: fail("NOT_FOUND", "Долг не найден") };
    }
    if (debt.status === "REPAID") {
      return { ok: false, error: fail("ALREADY_REPAID", "Долг уже погашен") };
    }
    if (debt.status === "CANCELLED") {
      return {
        ok: false,
        error: fail("NOT_ACTIVE", "Долг отменён (возврат продажи) — погасить нельзя"),
      };
    }

    const updated = await tx.debt.updateMany({
      where: { id: debt.id, status: "ACTIVE" },
      data: {
        status: "REPAID",
        repaidAt: input.repaidAt,
        repaidAmount: debt.amount,
      },
    });
    if (updated.count === 0) {
      return {
        ok: false,
        error: fail("NOT_ACTIVE", "Долг изменился параллельно — обновите"),
      };
    }

    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: "STATUS_CHANGE",
        entityType: "Debt",
        entityId: debt.id,
        payload: {
          kind: "debt.repay",
          from: "ACTIVE",
          to: "REPAID",
          repaidAt: input.repaidAt.toISOString(),
          repaidAmount: debt.amount.toString(),
        },
      },
    });

    return { ok: true, debtId: debt.id, status: "REPAID" };
  };

  if ("$transaction" in db && typeof db.$transaction === "function") {
    return db.$transaction((tx) => run(tx));
  }
  return run(db as Prisma.TransactionClient);
}

// ───────────────────────── cancelDebtForReturnedSale ─────────────────────────

/**
 * Closes debt when a CREDIT sale is returned. Inventory reverse stays in sales.ts;
 * this only mutates Debt. REPAID debts are intentionally left REPAID.
 */
export async function cancelDebtForReturnedSale(
  tx: Prisma.TransactionClient,
  input: CancelDebtForReturnedSaleInput,
): Promise<CancelDebtResult> {
  const saleRecordId = input.saleRecordId?.trim();
  if (!saleRecordId) {
    return { outcome: "none", debtId: null };
  }

  const debt = await tx.debt.findUnique({
    where: { saleRecordId },
    select: { id: true, status: true },
  });
  if (!debt) {
    return { outcome: "none", debtId: null };
  }
  if (debt.status === "CANCELLED") {
    return { outcome: "already_cancelled", debtId: debt.id };
  }
  if (debt.status === "REPAID") {
    // Money already collected — do not erase. Inventory return still proceeds.
    await tx.auditLog.create({
      data: {
        userId: input.actorId || null,
        action: "STATUS_CHANGE",
        entityType: "Debt",
        entityId: debt.id,
        payload: {
          kind: "debt.return_after_repaid",
          saleRecordId,
          note: "Продажа возвращена после погашения долга — статус REPAID сохранён",
          at: input.now.toISOString(),
        },
      },
    });
    return { outcome: "left_repaid", debtId: debt.id };
  }

  // ACTIVE → CANCELLED
  const updated = await tx.debt.updateMany({
    where: { id: debt.id, status: "ACTIVE" },
    data: { status: "CANCELLED" },
  });
  if (updated.count === 0) {
    // Race: repaid or cancelled in parallel
    const again = await tx.debt.findUnique({
      where: { id: debt.id },
      select: { status: true },
    });
    if (again?.status === "REPAID") {
      return { outcome: "left_repaid", debtId: debt.id };
    }
    return { outcome: "already_cancelled", debtId: debt.id };
  }

  await tx.auditLog.create({
    data: {
      userId: input.actorId || null,
      action: "STATUS_CHANGE",
      entityType: "Debt",
      entityId: debt.id,
      payload: {
        kind: "debt.cancel_return",
        saleRecordId,
        from: "ACTIVE",
        to: "CANCELLED",
        at: input.now.toISOString(),
      },
    },
  });

  return { outcome: "cancelled", debtId: debt.id };
}

// ───────────────────────── listDebts ─────────────────────────

export async function listDebts(
  db: PrismaClient | Prisma.TransactionClient,
  input: ListDebtsInput,
): Promise<{ items: DebtListItem[]; nextCursor: string | null }> {
  const pageSize = Math.min(
    MAX_PAGE,
    Math.max(1, input.pageSize ?? DEFAULT_PAGE),
  );
  const now = input.now;
  const statusFilter =
    !input.status || input.status === "ALL" ? undefined : input.status;

  const where: Prisma.DebtWhereInput = {};
  if (statusFilter) where.status = statusFilter;
  if (input.currency) where.currency = input.currency;
  if (input.managerId) {
    where.saleRecord = { ...(where.saleRecord as object), managerId: input.managerId };
  }
  if (input.q?.trim()) {
    const q = input.q.trim();
    where.saleRecord = {
      ...(where.saleRecord as object),
      OR: [
        { customerName: { contains: q, mode: "insensitive" } },
        { customerContact: { contains: q, mode: "insensitive" } },
      ],
    };
  }
  if (input.overdueOnly) {
    // End-of-Tashkent-day storage: overdue when dueDate < now (same as isDebtOverdue).
    where.status = "ACTIVE";
    where.dueDate = { lt: now };
  }
  if (input.cursor) {
    where.id = { lt: input.cursor }; // keyset: createdAt desc + id desc approximated by id
  }

  const rows = await db.debt.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    include: {
      saleRecord: {
        select: {
          customerName: true,
          customerContact: true,
          soldAt: true,
          price: true,
          targetType: true,
          qtySlabs: true,
          qtyAreaM2: true,
          managerId: true,
          manager: { select: { name: true } },
        },
      },
    },
  });

  const page = rows.slice(0, pageSize);
  const nextCursor =
    rows.length > pageSize ? page[page.length - 1]?.id ?? null : null;

  const items: DebtListItem[] = page.map((d) => ({
    id: d.id,
    saleRecordId: d.saleRecordId,
    amount: d.amount.toString(),
    currency: d.currency,
    status: d.status,
    dueDate: d.dueDate,
    comment: d.comment,
    repaidAt: d.repaidAt,
    repaidAmount: decimalString(d.repaidAmount),
    createdAt: d.createdAt,
    overdue: isDebtOverdue(d, now),
    sale: {
      customerName: d.saleRecord.customerName,
      customerContact: d.saleRecord.customerContact,
      soldAt: d.saleRecord.soldAt,
      price: decimalString(d.saleRecord.price),
      targetType: d.saleRecord.targetType,
      qtySlabs: d.saleRecord.qtySlabs,
      qtyAreaM2: decimalString(d.saleRecord.qtyAreaM2),
      managerId: d.saleRecord.managerId,
      managerName: d.saleRecord.manager.name,
    },
  }));

  return { items, nextCursor };
}

// ───────────────────────── debtSummary ─────────────────────────

/**
 * Per-currency ACTIVE totals and overdue subset. Never sums UZS+USD.
 */
export async function debtSummary(
  db: PrismaClient | Prisma.TransactionClient,
  input: { now: Date },
): Promise<DebtSummary> {
  const now = input.now;

  const active = await db.debt.findMany({
    where: { status: "ACTIVE" },
    select: {
      amount: true,
      currency: true,
      dueDate: true,
      saleRecord: { select: { customerName: true, customerContact: true } },
    },
    take: 10_000, // hard bound — owner portfolio, not unbounded
  });

  type Acc = { amount: Prisma.Decimal; count: number };
  const activeMap = new Map<Currency, Acc>();
  const overdueMap = new Map<Currency, Acc>();
  const debtorKeys = new Set<string>();

  for (const d of active) {
    const cur = d.currency;
    const prev = activeMap.get(cur) ?? {
      amount: new PrismaNS.Decimal(0),
      count: 0,
    };
    prev.amount = prev.amount.plus(d.amount);
    prev.count += 1;
    activeMap.set(cur, prev);

    const key = `${d.saleRecord.customerName}\0${d.saleRecord.customerContact ?? ""}`;
    debtorKeys.add(key);

    if (isDebtOverdue({ status: "ACTIVE", dueDate: d.dueDate }, now)) {
      const o = overdueMap.get(cur) ?? {
        amount: new PrismaNS.Decimal(0),
        count: 0,
      };
      o.amount = o.amount.plus(d.amount);
      o.count += 1;
      overdueMap.set(cur, o);
    }
  }

  const toList = (m: Map<Currency, Acc>): CurrencyMoney[] => {
    const out: CurrencyMoney[] = [];
    for (const cur of ["UZS", "USD"] as Currency[]) {
      const row = m.get(cur);
      if (!row || row.count === 0) continue; // omit empty currency
      out.push({
        currency: cur,
        amount: row.amount.toFixed(2),
        count: row.count,
      });
    }
    return out;
  };

  return {
    activeByCurrency: toList(activeMap),
    overdueByCurrency: toList(overdueMap),
    activeDebtorCount: debtorKeys.size,
  };
}
