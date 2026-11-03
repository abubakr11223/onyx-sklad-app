// ТЗ №20 A — платежи по продаже.
//
// У продажи — СПИСОК платежей (50/50, 70/30, предоплата), а не одно поле
// «способ оплаты». «В долг» больше не способ: долг — это остаток
//   долг = цена − Σ оплат при продаже,
// и он гасится платежами по долгу (по частям или одной суммой клиента на
// несколько долгов, от старого к новому). Валюта платежа = валюта продажи —
// сум и $ никогда не складываются (раздел 14).
//
// Деньги (Decimal) считаем в целых тийинах/центах (×100) — без плавающих хвостов.

import type { Prisma, PrismaClient } from "@prisma/client";
import { createDebtForSale } from "./debts";

/** Ошибка домена платежей (текст — для пользователя). */
export class PaymentError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "OVERPAID"
      | "NOT_FOUND"
      | "NOT_ACTIVE"
      | "FORBIDDEN"
      | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

import {
  centsToStr,
  checkSalePayments,
  decToCents,
  isPayMethod,
  toCents,
  type PayCurrency,
  type PayMethod,
  type PaymentRowInput,
} from "./payment-rows";

export * from "./payment-rows";

/**
 * Записывает платежи продажи и, если оплачено меньше цены, открывает долг на
 * остаток. Вызывается В ТОЙ ЖЕ транзакции, что saleRecord.create.
 */
export async function settleSaleInTx(
  tx: Prisma.TransactionClient,
  args: {
    saleId: string;
    price: number;
    currency: PayCurrency;
    rows: readonly PaymentRowInput[];
    receivedById: string;
    paidAt: Date;
    debtDueDate?: Date | null;
    debtComment?: string | null;
    clientId?: string | null;
  },
): Promise<{ debtId: string | null; paidCents: number; debtCents: number }> {
  const check = checkSalePayments(args.price, args.rows);
  if (!check.ok) throw new PaymentError("OVERPAID", check.message);
  for (const r of check.rows) {
    await tx.payment.create({
      data: {
        saleRecordId: args.saleId,
        kind: "PAYMENT",
        amount: centsToStr(toCents(r.amount)),
        currency: args.currency,
        method: r.method,
        paidAt: args.paidAt,
        receivedById: args.receivedById,
      },
    });
  }
  let debtId: string | null = null;
  if (check.debtCents > 0) {
    const debt = await createDebtForSale(tx, {
      saleRecordId: args.saleId,
      amount: centsToStr(check.debtCents),
      currency: args.currency,
      dueDate: args.debtDueDate ?? null,
      comment: args.debtComment ?? null,
      clientId: args.clientId ?? null,
    });
    debtId = debt.debtId;
  }
  return { debtId, paidCents: check.paidCents, debtCents: check.debtCents };
}

/** Остаток долга: amount − уже внесено (repaidAmount). */
export function debtRemainingCents(d: {
  amount: { toString(): string };
  repaidAmount: { toString(): string } | null;
}): number {
  return Math.max(0, decToCents(d.amount) - decToCents(d.repaidAmount));
}

type Db = PrismaClient | Prisma.TransactionClient;

async function inTx<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if ("$transaction" in db && typeof db.$transaction === "function") {
    return (db as PrismaClient).$transaction((tx) => fn(tx));
  }
  return fn(db as Prisma.TransactionClient);
}

/** Внутри tx: платёж по одному долгу (частично или целиком). */
async function payDebtInTx(
  tx: Prisma.TransactionClient,
  args: {
    debtId: string;
    amountCents: number;
    method: PayMethod;
    paidAt: Date;
    actorId: string;
    comment?: string | null;
    group?: string | null;
  },
): Promise<{ remainingCents: number; closed: boolean; saleRecordId: string; currency: PayCurrency }> {
  // Сериализуем параллельные платежи по одному долгу.
  await tx.$queryRaw`SELECT id FROM "Debt" WHERE id = ${args.debtId} FOR UPDATE`;
  const debt = await tx.debt.findUnique({
    where: { id: args.debtId },
    select: {
      id: true,
      status: true,
      amount: true,
      repaidAmount: true,
      currency: true,
      saleRecordId: true,
    },
  });
  if (!debt) throw new PaymentError("NOT_FOUND", "Долг не найден");
  if (debt.status !== "ACTIVE") {
    throw new PaymentError("NOT_ACTIVE", "Долг уже закрыт — обновите страницу");
  }
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new PaymentError("INVALID_INPUT", "Сумма платежа — положительное число");
  }
  const remaining = debtRemainingCents(debt);
  if (args.amountCents > remaining) {
    throw new PaymentError(
      "OVERPAID",
      `Платёж больше остатка долга (остаток ${centsToStr(remaining)})`,
    );
  }
  await tx.payment.create({
    data: {
      saleRecordId: debt.saleRecordId,
      debtId: debt.id,
      kind: "PAYMENT",
      amount: centsToStr(args.amountCents),
      currency: debt.currency,
      method: args.method,
      paidAt: args.paidAt,
      receivedById: args.actorId,
      comment: args.comment?.trim() || null,
      clientPaymentGroup: args.group ?? null,
    },
  });
  const newRepaid = decToCents(debt.repaidAmount) + args.amountCents;
  const left = decToCents(debt.amount) - newRepaid;
  const closed = left <= 0;
  await tx.debt.update({
    where: { id: debt.id },
    data: {
      repaidAmount: centsToStr(newRepaid),
      ...(closed ? { status: "REPAID", repaidAt: args.paidAt } : {}),
    },
  });
  await tx.auditLog.create({
    data: {
      userId: args.actorId,
      action: "STATUS_CHANGE",
      entityType: "Debt",
      entityId: debt.id,
      payload: {
        kind: "debt.payment",
        saleRecordId: debt.saleRecordId,
        amount: centsToStr(args.amountCents),
        currency: debt.currency,
        method: args.method,
        paidAt: args.paidAt.toISOString(),
        remaining: centsToStr(Math.max(0, left)),
        closed,
        group: args.group ?? null,
      },
    },
  });
  return {
    remainingCents: Math.max(0, left),
    closed,
    saleRecordId: debt.saleRecordId,
    currency: debt.currency,
  };
}

/** §2.3 — внести платёж по долгу (по умолчанию — весь остаток). */
export async function addDebtPayment(
  db: Db,
  args: {
    debtId: string;
    amount: number;
    method: PayMethod;
    paidAt: Date;
    actorId: string;
    comment?: string | null;
  },
): Promise<{ remainingCents: number; closed: boolean }> {
  if (!isPayMethod(args.method)) {
    throw new PaymentError("INVALID_INPUT", "Выберите способ оплаты");
  }
  return inTx(db, async (tx) => {
    const r = await payDebtInTx(tx, {
      debtId: args.debtId,
      amountCents: toCents(args.amount),
      method: args.method,
      paidAt: args.paidAt,
      actorId: args.actorId,
      comment: args.comment,
    });
    return { remainingCents: r.remainingCents, closed: r.closed };
  });
}

/** Долг клиента для раскладки платежа. */
export interface OpenDebtForAllocation {
  debtId: string;
  createdAt: Date;
  remainingCents: number;
}

export interface AllocationLine {
  debtId: string;
  amountCents: number;
  /** Остаток после этой строки. */
  leftCents: number;
}

/**
 * §2.4 — раскладка одной суммы по долгам клиента ОТ СТАРОГО К НОВОМУ.
 * Сверх суммы всех долгов — ошибка (не принимаем больше, чем должен).
 */
export function planClientPayment(
  debts: readonly OpenDebtForAllocation[],
  totalCents: number,
): { ok: true; lines: AllocationLine[] } | { ok: false; message: string } {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    return { ok: false, message: "Сумма платежа — положительное число" };
  }
  const sorted = [...debts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.debtId.localeCompare(b.debtId),
  );
  const totalDebt = sorted.reduce((s, d) => s + d.remainingCents, 0);
  if (totalCents > totalDebt) {
    return {
      ok: false,
      message: `Сумма больше всех долгов клиента в этой валюте (${centsToStr(totalDebt)})`,
    };
  }
  let left = totalCents;
  const lines: AllocationLine[] = [];
  for (const d of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, d.remainingCents);
    if (take <= 0) continue;
    lines.push({ debtId: d.debtId, amountCents: take, leftCents: d.remainingCents - take });
    left -= take;
  }
  return { ok: true, lines };
}

/**
 * Проверка ручной правки раскладки: каждая строка ≤ остатка своего долга,
 * долги — этого клиента и этой валюты. Сумма строк = итог платежа.
 */
export function checkManualAllocation(
  debts: readonly OpenDebtForAllocation[],
  lines: readonly { debtId: string; amountCents: number }[],
): { ok: true } | { ok: false; message: string } {
  const byId = new Map(debts.map((d) => [d.debtId, d]));
  for (const l of lines) {
    const d = byId.get(l.debtId);
    if (!d) return { ok: false, message: "Долг не принадлежит клиенту или уже закрыт" };
    if (!Number.isInteger(l.amountCents) || l.amountCents < 0) {
      return { ok: false, message: "Суммы раскладки — неотрицательные числа" };
    }
    if (l.amountCents > d.remainingCents) {
      return { ok: false, message: "Сумма по долгу больше его остатка" };
    }
  }
  if (!lines.some((l) => l.amountCents > 0)) {
    return { ok: false, message: "Укажите сумму хотя бы по одному долгу" };
  }
  return { ok: true };
}

/** Открытые долги клиента в валюте (для раскладки). Менеджер — только своих продаж. */
export async function loadClientOpenDebts(
  db: Db,
  args: { clientId: string; currency: PayCurrency; managerId?: string | null },
): Promise<(OpenDebtForAllocation & { soldAt: Date; amountCents: number })[]> {
  const rows = await db.debt.findMany({
    where: {
      clientId: args.clientId,
      currency: args.currency,
      status: "ACTIVE",
      ...(args.managerId ? { saleRecord: { managerId: args.managerId } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      createdAt: true,
      amount: true,
      repaidAmount: true,
      saleRecord: { select: { soldAt: true } },
    },
  });
  return rows.map((d) => ({
    debtId: d.id,
    createdAt: d.createdAt,
    soldAt: d.saleRecord.soldAt,
    amountCents: decToCents(d.amount),
    remainingCents: debtRemainingCents(d),
  }));
}

/**
 * §2.4 — «Внести платёж клиента»: одна сумма → несколько долгов (раскладка
 * уже показана и, возможно, поправлена менеджером). Одна транзакция, общий
 * идентификатор группы — в истории видно, что это один приход денег.
 */
export async function applyClientPayment(
  db: PrismaClient,
  args: {
    clientId: string;
    currency: PayCurrency;
    lines: readonly { debtId: string; amountCents: number }[];
    method: PayMethod;
    paidAt: Date;
    actorId: string;
    /** Менеджер — только долги своих продаж; владелец — null (все). */
    restrictManagerId?: string | null;
  },
): Promise<{ paid: number; closed: number }> {
  if (!isPayMethod(args.method)) {
    throw new PaymentError("INVALID_INPUT", "Выберите способ оплаты");
  }
  return db.$transaction(async (tx) => {
    const debts = await loadClientOpenDebts(tx, {
      clientId: args.clientId,
      currency: args.currency,
      managerId: args.restrictManagerId ?? null,
    });
    const check = checkManualAllocation(debts, args.lines);
    if (!check.ok) throw new PaymentError("INVALID_INPUT", check.message);
    const group = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let paid = 0;
    let closed = 0;
    for (const l of args.lines) {
      if (l.amountCents <= 0) continue;
      const r = await payDebtInTx(tx, {
        debtId: l.debtId,
        amountCents: l.amountCents,
        method: args.method,
        paidAt: args.paidAt,
        actorId: args.actorId,
        group,
      });
      paid += 1;
      if (r.closed) closed += 1;
    }
    return { paid, closed };
  });
}

/** Возврат денег клиенту (часть F / полный возврат продажи). */
export async function recordRefundInTx(
  tx: Prisma.TransactionClient,
  args: {
    saleId: string;
    amountCents: number;
    currency: PayCurrency;
    method: PayMethod;
    paidAt: Date;
    actorId: string;
    comment?: string | null;
  },
): Promise<void> {
  if (args.amountCents <= 0) return;
  await tx.payment.create({
    data: {
      saleRecordId: args.saleId,
      kind: "REFUND",
      amount: centsToStr(args.amountCents),
      currency: args.currency,
      method: args.method,
      paidAt: args.paidAt,
      receivedById: args.actorId,
      comment: args.comment?.trim() || null,
    },
  });
}

/** Сколько клиент фактически заплатил по продаже (оплаты − возвраты денег). */
export async function netPaidCents(
  tx: Prisma.TransactionClient,
  saleId: string,
): Promise<number> {
  const rows = await tx.payment.groupBy({
    by: ["kind"],
    where: { saleRecordId: saleId },
    _sum: { amount: true },
  });
  let net = 0;
  for (const r of rows) {
    const c = decToCents(r._sum.amount);
    net += r.kind === "REFUND" ? -c : c;
  }
  return net;
}

/** «5 000 000» / «300» — сумма без валюты, ru-формат. */
export function formatMoneyCents(cents: number, currency: PayCurrency): string {
  const v = cents / 100;
  const s = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(v);
  return currency === "USD" ? `$${s}` : `${s} сум`;
}

