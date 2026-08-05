// TZ №10+11 Этап 3 — справочники «Клиенты» / «Объекты»: domain + pure totals.
// Суммы считаются из SaleRecord (returnedAt == null), НЕ хранятся отдельно.
// UZS и USD НИКОГДА не складываются (CONTRACT / «Правки модели» §5).

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  clientListScope,
  normalizeClientPhone,
  phonesMatch,
  sumMoneyByCurrency,
  type ClientType,
  type CurrencyMoney,
  type MoneyCurrency,
  type SiteStatus,
  type SiteType,
} from "@/lib/clients";

type Db = PrismaClient | Prisma.TransactionClient;

/** Sale row used for purchase / volume totals (directory cards). */
export type SaleTotRow = {
  returnedAt: Date | null;
  price: string | null;
  currency: MoneyCurrency | null;
  qtySlabs: number | null;
  qtyAreaM2: string | null;
};

/** Debt row for active-debt totals. */
export type DebtTotRow = {
  status: "ACTIVE" | "REPAID" | "CANCELLED";
  amount: string;
  currency: MoneyCurrency;
};

/** Active sale = not returned. Returned sales must not enter «итого куплено». */
export function isActiveSale(sale: { returnedAt: Date | null }): boolean {
  return sale.returnedAt == null;
}

/**
 * Purchase totals per currency from sales.
 * - skips returned (returnedAt set)
 * - skips missing price/currency (legacy incomplete rows)
 * - never mixes UZS+USD
 */
export function purchaseTotalsFromSales(
  sales: ReadonlyArray<SaleTotRow>,
): CurrencyMoney[] {
  const rows: { amount: string; currency: MoneyCurrency }[] = [];
  for (const s of sales) {
    if (!isActiveSale(s)) continue;
    if (s.price == null || s.currency == null) continue;
    if (s.currency !== "UZS" && s.currency !== "USD") continue;
    rows.push({ amount: s.price, currency: s.currency });
  }
  return sumMoneyByCurrency(rows);
}

/**
 * Shipped volume from active sales: slabs count + m² sum (decimal string).
 * Returned sales excluded. Area summed as cents-of-milli (3 dp) via integer math.
 */
export function volumeTotalsFromSales(sales: ReadonlyArray<SaleTotRow>): {
  qtySlabs: number;
  qtyAreaM2: string;
  saleCount: number;
} {
  let qtySlabs = 0;
  let areaMilli = 0n; // thousandths of m²
  let saleCount = 0;
  for (const s of sales) {
    if (!isActiveSale(s)) continue;
    saleCount += 1;
    if (s.qtySlabs != null && s.qtySlabs > 0) qtySlabs += s.qtySlabs;
    if (s.qtyAreaM2 != null && s.qtyAreaM2 !== "") {
      areaMilli += areaToMilli(s.qtyAreaM2);
    }
  }
  return {
    qtySlabs,
    qtyAreaM2: milliToArea(areaMilli),
    saleCount,
  };
}

function areaToMilli(raw: string): bigint {
  const s = raw.trim().replace(",", ".");
  const m = /^(-?)(\d+)(?:\.(\d{0,3})\d*)?$/.exec(s);
  if (!m) return 0n;
  const neg = m[1] === "-";
  const whole = BigInt(m[2] || "0");
  const frac = BigInt(((m[3] ?? "") + "000").slice(0, 3));
  const v = whole * 1000n + frac;
  return neg ? -v : v;
}

function milliToArea(milli: bigint): string {
  const neg = milli < 0n;
  const a = neg ? -milli : milli;
  const whole = a / 1000n;
  const frac = a % 1000n;
  // Always 3 dp string for stable tests; UI may pretty-print.
  const body = `${whole.toString()}.${frac.toString().padStart(3, "0")}`;
  return neg ? `-${body}` : body;
}

/** Active debt totals per currency (ACTIVE only). Never mixes currencies. */
export function debtTotalsFromDebts(
  debts: ReadonlyArray<DebtTotRow>,
): CurrencyMoney[] {
  const rows: { amount: string; currency: MoneyCurrency }[] = [];
  for (const d of debts) {
    if (d.status !== "ACTIVE") continue;
    if (d.currency !== "UZS" && d.currency !== "USD") continue;
    rows.push({ amount: d.amount, currency: d.currency });
  }
  return sumMoneyByCurrency(rows);
}

/**
 * Whether actor may see this client/site record (TZ §12).
 * Owner (canSeeAll) → true; manager → only own managerId.
 */
export function canAccessDirectoryRecord(args: {
  canSeeAllClients: boolean;
  actorId: string | null;
  recordManagerId: string;
}): boolean {
  if (args.canSeeAllClients) return true;
  if (!args.actorId) return false;
  return args.actorId === args.recordManagerId;
}

/** Format volume for list/card: «3 плит · 12,5 м²» or partial. */
export function formatVolumeLine(v: {
  qtySlabs: number;
  qtyAreaM2: string;
}): string | null {
  const parts: string[] = [];
  if (v.qtySlabs > 0) {
    parts.push(`${v.qtySlabs} плит`);
  }
  const area = (v.qtyAreaM2 ?? "").trim();
  const areaNum = Number(area.replace(",", "."));
  if (Number.isFinite(areaNum) && areaNum > 0) {
    // RU decimal comma; trim trailing zeros (12.750 → 12,75)
    const nice = areaNum.toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
    parts.push(`${nice} м²`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ───────────────────────── DB: list / card ─────────────────────────

export type ClientListFilters = {
  q?: string;
  type?: ClientType | "";
  /** Filter by who created the client (owner can filter any). */
  managerId?: string;
  canSeeAllClients: boolean;
  actorId: string | null;
  take?: number;
};

export type ClientListItem = {
  id: string;
  name: string;
  type: ClientType;
  phone: string;
  managerId: string;
  managerName: string;
  saleCount: number;
  purchaseTotals: CurrencyMoney[];
  hasActiveDebt: boolean;
  activeDebtTotals: CurrencyMoney[];
};

export async function listClientsDirectory(
  db: Db,
  filters: ClientListFilters,
): Promise<ClientListItem[]> {
  const scope = clientListScope({
    canSeeAllClients: filters.canSeeAllClients,
    actorId: filters.actorId,
  });
  const where: Prisma.ClientWhereInput = { ...scope };
  if (filters.type === "B2C" || filters.type === "B2B") {
    where.type = filters.type;
  }
  if (filters.managerId?.trim() && filters.canSeeAllClients) {
    where.managerId = filters.managerId.trim();
  }
  const q = filters.q?.trim();
  if (q) {
    const digits = normalizeClientPhone(q);
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ];
  }

  const take = Math.min(100, Math.max(1, filters.take ?? 50));
  const rows = await db.client.findMany({
    where,
    orderBy: [{ name: "asc" }],
    take,
    select: {
      id: true,
      name: true,
      type: true,
      phone: true,
      managerId: true,
      manager: { select: { name: true } },
      sales: {
        select: {
          returnedAt: true,
          price: true,
          currency: true,
          qtySlabs: true,
          qtyAreaM2: true,
        },
      },
      debts: {
        where: { status: "ACTIVE" },
        select: { amount: true, currency: true, status: true },
      },
    },
  });

  return rows.map((r) => {
    const sales: SaleTotRow[] = r.sales.map((s) => ({
      returnedAt: s.returnedAt,
      price: s.price?.toString() ?? null,
      currency: (s.currency as MoneyCurrency | null) ?? null,
      qtySlabs: s.qtySlabs,
      qtyAreaM2: s.qtyAreaM2?.toString() ?? null,
    }));
    const debts: DebtTotRow[] = r.debts.map((d) => ({
      status: d.status as DebtTotRow["status"],
      amount: d.amount.toString(),
      currency: d.currency as MoneyCurrency,
    }));
    const vol = volumeTotalsFromSales(sales);
    return {
      id: r.id,
      name: r.name,
      type: r.type as ClientType,
      phone: r.phone,
      managerId: r.managerId,
      managerName: r.manager.name,
      saleCount: vol.saleCount,
      purchaseTotals: purchaseTotalsFromSales(sales),
      hasActiveDebt: debts.length > 0,
      activeDebtTotals: debtTotalsFromDebts(debts),
    };
  });
}

export type ClientCard = {
  id: string;
  name: string;
  type: ClientType;
  phone: string;
  extraContacts: string | null;
  comment: string | null;
  managerId: string;
  managerName: string;
  createdAt: Date;
  sites: Array<{
    id: string;
    name: string;
    type: SiteType;
    status: SiteStatus;
    purchaseTotals: CurrencyMoney[];
    volume: { qtySlabs: number; qtyAreaM2: string; saleCount: number };
  }>;
  sales: Array<{
    id: string;
    soldAt: Date;
    returnedAt: Date | null;
    targetType: string;
    qtySlabs: number | null;
    qtyAreaM2: string | null;
    price: string | null;
    currency: MoneyCurrency | null;
    paymentMethod: string | null;
    siteId: string | null;
    siteName: string | null;
    managerName: string;
  }>;
  debts: Array<{
    id: string;
    amount: string;
    currency: MoneyCurrency;
    status: string;
    dueDate: Date | null;
    saleId: string;
  }>;
  reservations: Array<{
    id: string;
    customerName: string;
    expiresAt: Date;
    targetType: string;
  }>;
  purchaseTotals: CurrencyMoney[];
  debtTotals: CurrencyMoney[];
  volume: { qtySlabs: number; qtyAreaM2: string; saleCount: number };
};

export async function getClientDirectoryCard(
  db: Db,
  args: {
    clientId: string;
    canSeeAllClients: boolean;
    actorId: string | null;
    now?: Date;
  },
): Promise<ClientCard | null> {
  const row = await db.client.findUnique({
    where: { id: args.clientId },
    select: {
      id: true,
      name: true,
      type: true,
      phone: true,
      extraContacts: true,
      comment: true,
      managerId: true,
      createdAt: true,
      manager: { select: { name: true } },
      sites: {
        orderBy: [{ status: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          sales: {
            select: {
              returnedAt: true,
              price: true,
              currency: true,
              qtySlabs: true,
              qtyAreaM2: true,
            },
          },
        },
      },
      sales: {
        orderBy: [{ soldAt: "desc" }, { id: "desc" }],
        take: 200,
        select: {
          id: true,
          soldAt: true,
          returnedAt: true,
          targetType: true,
          qtySlabs: true,
          qtyAreaM2: true,
          price: true,
          currency: true,
          paymentMethod: true,
          siteId: true,
          site: { select: { name: true } },
          manager: { select: { name: true } },
        },
      },
      debts: {
        orderBy: [{ createdAt: "desc" }],
        take: 50,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          dueDate: true,
          saleRecordId: true,
        },
      },
    },
  });
  if (!row) return null;
  if (
    !canAccessDirectoryRecord({
      canSeeAllClients: args.canSeeAllClients,
      actorId: args.actorId,
      recordManagerId: row.managerId,
    })
  ) {
    return null;
  }

  const salesTot: SaleTotRow[] = row.sales.map((s) => ({
    returnedAt: s.returnedAt,
    price: s.price?.toString() ?? null,
    currency: (s.currency as MoneyCurrency | null) ?? null,
    qtySlabs: s.qtySlabs,
    qtyAreaM2: s.qtyAreaM2?.toString() ?? null,
  }));

  const debtRows: DebtTotRow[] = row.debts.map((d) => ({
    status: d.status as DebtTotRow["status"],
    amount: d.amount.toString(),
    currency: d.currency as MoneyCurrency,
  }));

  // Active reservations: soft match by name or normalized phone (no clientId on Reservation yet).
  const now = args.now ?? new Date();
  const resRows = await db.reservation.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { gt: now },
      OR: [
        { customerName: row.name },
        { customerContact: { contains: normalizeClientPhone(row.phone).slice(-9) || row.phone } },
      ],
    },
    orderBy: { expiresAt: "asc" },
    take: 30,
    select: {
      id: true,
      customerName: true,
      customerContact: true,
      expiresAt: true,
      targetType: true,
    },
  });
  const reservations = resRows.filter(
    (r) =>
      r.customerName === row.name ||
      (r.customerContact != null && phonesMatch(r.customerContact, row.phone)),
  );

  return {
    id: row.id,
    name: row.name,
    type: row.type as ClientType,
    phone: row.phone,
    extraContacts: row.extraContacts,
    comment: row.comment,
    managerId: row.managerId,
    managerName: row.manager.name,
    createdAt: row.createdAt,
    sites: row.sites.map((s) => {
      const ss: SaleTotRow[] = s.sales.map((x) => ({
        returnedAt: x.returnedAt,
        price: x.price?.toString() ?? null,
        currency: (x.currency as MoneyCurrency | null) ?? null,
        qtySlabs: x.qtySlabs,
        qtyAreaM2: x.qtyAreaM2?.toString() ?? null,
      }));
      return {
        id: s.id,
        name: s.name,
        type: s.type as SiteType,
        status: s.status as SiteStatus,
        purchaseTotals: purchaseTotalsFromSales(ss),
        volume: volumeTotalsFromSales(ss),
      };
    }),
    sales: row.sales.map((s) => ({
      id: s.id,
      soldAt: s.soldAt,
      returnedAt: s.returnedAt,
      targetType: s.targetType,
      qtySlabs: s.qtySlabs,
      qtyAreaM2: s.qtyAreaM2?.toString() ?? null,
      price: s.price?.toString() ?? null,
      currency: (s.currency as MoneyCurrency | null) ?? null,
      paymentMethod: s.paymentMethod,
      siteId: s.siteId,
      siteName: s.site?.name ?? null,
      managerName: s.manager.name,
    })),
    debts: row.debts.map((d) => ({
      id: d.id,
      amount: d.amount.toString(),
      currency: d.currency as MoneyCurrency,
      status: d.status,
      dueDate: d.dueDate,
      saleId: d.saleRecordId,
    })),
    reservations: reservations.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      expiresAt: r.expiresAt,
      targetType: r.targetType,
    })),
    purchaseTotals: purchaseTotalsFromSales(salesTot),
    debtTotals: debtTotalsFromDebts(debtRows),
    volume: volumeTotalsFromSales(salesTot),
  };
}

export type SiteListFilters = {
  status?: SiteStatus | "ALL" | "";
  type?: SiteType | "";
  clientId?: string;
  q?: string;
  canSeeAllClients: boolean;
  actorId: string | null;
  take?: number;
};

export type SiteListItem = {
  id: string;
  name: string;
  type: SiteType;
  status: SiteStatus;
  address: string | null;
  clientId: string;
  clientName: string;
  managerId: string;
  managerName: string;
  purchaseTotals: CurrencyMoney[];
  volume: { qtySlabs: number; qtyAreaM2: string; saleCount: number };
};

export async function listSitesDirectory(
  db: Db,
  filters: SiteListFilters,
): Promise<SiteListItem[]> {
  const scope = clientListScope({
    canSeeAllClients: filters.canSeeAllClients,
    actorId: filters.actorId,
  });
  const where: Prisma.SiteWhereInput = { ...scope };
  if (filters.status === "ACTIVE" || filters.status === "COMPLETED") {
    where.status = filters.status;
  }
  if (
    filters.type === "RESIDENTIAL" ||
    filters.type === "COMMERCIAL" ||
    filters.type === "OTHER"
  ) {
    where.type = filters.type;
  }
  if (filters.clientId?.trim()) {
    where.clientId = filters.clientId.trim();
  }
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { address: { contains: q, mode: "insensitive" } },
      { client: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const take = Math.min(100, Math.max(1, filters.take ?? 50));
  const rows = await db.site.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take,
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      address: true,
      clientId: true,
      managerId: true,
      client: { select: { name: true } },
      manager: { select: { name: true } },
      sales: {
        select: {
          returnedAt: true,
          price: true,
          currency: true,
          qtySlabs: true,
          qtyAreaM2: true,
        },
      },
    },
  });

  return rows.map((r) => {
    const sales: SaleTotRow[] = r.sales.map((s) => ({
      returnedAt: s.returnedAt,
      price: s.price?.toString() ?? null,
      currency: (s.currency as MoneyCurrency | null) ?? null,
      qtySlabs: s.qtySlabs,
      qtyAreaM2: s.qtyAreaM2?.toString() ?? null,
    }));
    return {
      id: r.id,
      name: r.name,
      type: r.type as SiteType,
      status: r.status as SiteStatus,
      address: r.address,
      clientId: r.clientId,
      clientName: r.client.name,
      managerId: r.managerId,
      managerName: r.manager.name,
      purchaseTotals: purchaseTotalsFromSales(sales),
      volume: volumeTotalsFromSales(sales),
    };
  });
}

export type SiteCard = {
  id: string;
  name: string;
  type: SiteType;
  status: SiteStatus;
  address: string | null;
  comment: string | null;
  contactPerson: string | null;
  clientId: string;
  clientName: string;
  clientPhone: string;
  managerId: string;
  managerName: string;
  sales: Array<{
    id: string;
    soldAt: Date;
    returnedAt: Date | null;
    targetType: string;
    qtySlabs: number | null;
    qtyAreaM2: string | null;
    price: string | null;
    currency: MoneyCurrency | null;
    paymentMethod: string | null;
    managerName: string;
  }>;
  purchaseTotals: CurrencyMoney[];
  debtTotals: CurrencyMoney[];
  volume: { qtySlabs: number; qtyAreaM2: string; saleCount: number };
};

export async function getSiteDirectoryCard(
  db: Db,
  args: {
    siteId: string;
    canSeeAllClients: boolean;
    actorId: string | null;
  },
): Promise<SiteCard | null> {
  const row = await db.site.findUnique({
    where: { id: args.siteId },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      address: true,
      comment: true,
      contactPerson: true,
      clientId: true,
      managerId: true,
      client: { select: { name: true, phone: true } },
      manager: { select: { name: true } },
      sales: {
        orderBy: [{ soldAt: "desc" }, { id: "desc" }],
        take: 200,
        select: {
          id: true,
          soldAt: true,
          returnedAt: true,
          targetType: true,
          qtySlabs: true,
          qtyAreaM2: true,
          price: true,
          currency: true,
          paymentMethod: true,
          manager: { select: { name: true } },
          debt: {
            select: {
              amount: true,
              currency: true,
              status: true,
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  if (
    !canAccessDirectoryRecord({
      canSeeAllClients: args.canSeeAllClients,
      actorId: args.actorId,
      recordManagerId: row.managerId,
    })
  ) {
    return null;
  }

  const salesTot: SaleTotRow[] = row.sales.map((s) => ({
    returnedAt: s.returnedAt,
    price: s.price?.toString() ?? null,
    currency: (s.currency as MoneyCurrency | null) ?? null,
    qtySlabs: s.qtySlabs,
    qtyAreaM2: s.qtyAreaM2?.toString() ?? null,
  }));

  const debtRows: DebtTotRow[] = [];
  for (const s of row.sales) {
    if (!s.debt) continue;
    debtRows.push({
      status: s.debt.status as DebtTotRow["status"],
      amount: s.debt.amount.toString(),
      currency: s.debt.currency as MoneyCurrency,
    });
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type as SiteType,
    status: row.status as SiteStatus,
    address: row.address,
    comment: row.comment,
    contactPerson: row.contactPerson,
    clientId: row.clientId,
    clientName: row.client.name,
    clientPhone: row.client.phone,
    managerId: row.managerId,
    managerName: row.manager.name,
    sales: row.sales.map((s) => ({
      id: s.id,
      soldAt: s.soldAt,
      returnedAt: s.returnedAt,
      targetType: s.targetType,
      qtySlabs: s.qtySlabs,
      qtyAreaM2: s.qtyAreaM2?.toString() ?? null,
      price: s.price?.toString() ?? null,
      currency: (s.currency as MoneyCurrency | null) ?? null,
      paymentMethod: s.paymentMethod,
      managerName: s.manager.name,
    })),
    purchaseTotals: purchaseTotalsFromSales(salesTot),
    debtTotals: debtTotalsFromDebts(debtRows),
    volume: volumeTotalsFromSales(salesTot),
  };
}

/**
 * Mark site COMPLETED. Scope-checked. Returns error code string or null on ok.
 */
export async function completeSiteRecord(
  db: Db,
  args: {
    siteId: string;
    canSeeAllClients: boolean;
    actorId: string | null;
  },
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "ALREADY" }> {
  const site = await db.site.findUnique({
    where: { id: args.siteId },
    select: { id: true, managerId: true, status: true },
  });
  if (!site) return { ok: false, code: "NOT_FOUND" };
  if (
    !canAccessDirectoryRecord({
      canSeeAllClients: args.canSeeAllClients,
      actorId: args.actorId,
      recordManagerId: site.managerId,
    })
  ) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (site.status === "COMPLETED") return { ok: false, code: "ALREADY" };
  await db.site.update({
    where: { id: site.id },
    data: { status: "COMPLETED" },
  });
  return { ok: true };
}
