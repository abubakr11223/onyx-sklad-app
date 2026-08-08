// W8-B — Sotuv tarixi: filter + keyset paginatsiya (TZ §5.4 «уходит в историю»,
// §6.1/§6.2 sotuv yozuvi). SQL WHERE filtrlangan; kursor shu filtrlangan tartib
// bo'yicha (soldAt DESC, id DESC) — poisk-query dagi «filtrlangan ro'yxatdan
// kursor olish / unbounded fetch» xatolari takrorlanmasin.
//
// Rol (tor o'qish, TZ §3):
//  • OWNER (canSeeHistory) — barcha menejerlar sotuvlari;
//  • MANAGER (canSell, !canSeeHistory) — faqat o'z managerId;
//  • WAREHOUSE/PARTNER — ro'yxat yo'q (§3 «не видит … продажи»).
// Narx: SaleRecord.price — sotuv narxi; ko'rsatish canSeePrices ga bog'liq
// (purchasePrice SaleRecord da yo'q).

import type { Prisma, PrismaClient } from "@prisma/client";

export const SALE_HISTORY_PAGE_SIZE = 20;

export type SaleHistoryReturnedFilter = "all" | "yes" | "no";

export type SaleHistoryFilters = {
  /** null = barcha menejerlar (faqat OWNER/canSeeHistory). */
  managerId: string | null;
  /** Inclusive Tashkent day start (UTC instant), yoki null. */
  from: Date | null;
  /** Inclusive Tashkent day end (UTC instant), yoki null. */
  to: Date | null;
  /** Mijoz ismi contains (trim); bo'sh = filtr yo'q. */
  customerQ: string;
  returned: SaleHistoryReturnedFilter;
};

export type SaleHistoryCursor = {
  soldAt: Date;
  id: string;
};

/**
 * Kim qanday doirada sotuv tarixini ko'radi.
 * Tor o'qish: menejerlar o'zaro sotuvlarni KO'RMAYDI (spec aniq «hamma sotuv»
 * bermaydi; OWNER «видит всё» / canSeeHistory).
 */
export function saleHistoryAccess(args: {
  canSell: boolean;
  canSeeHistory: boolean;
  actorId: string | null;
}):
  | { allowed: false }
  | { allowed: true; managerId: string | null } {
  if (!args.canSell) return { allowed: false };
  if (args.canSeeHistory) return { allowed: true, managerId: null };
  if (!args.actorId) return { allowed: false };
  return { allowed: true, managerId: args.actorId };
}

/** YYYY-MM-DD → Tashkent 00:00:00.000+05:00, yaroqsiz → null. */
export function parseTashkentDayStart(iso: string): Date | null {
  const s = iso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000+05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD → Tashkent 23:59:59.999+05:00. */
export function parseTashkentDayEnd(iso: string): Date | null {
  const s = iso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T23:59:59.999+05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Cursor: `${soldAt.toISOString()}_${id}` — tartib barqaror, unique id. */
export function encodeSaleHistoryCursor(c: SaleHistoryCursor): string {
  return `${c.soldAt.toISOString()}_${c.id}`;
}

export function parseSaleHistoryCursor(
  raw: string | null | undefined,
): SaleHistoryCursor | null {
  if (!raw) return null;
  const s = raw.trim();
  const i = s.indexOf("_");
  if (i <= 0) return null;
  const iso = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!id) return null;
  const soldAt = new Date(iso);
  if (Number.isNaN(soldAt.getTime())) return null;
  return { soldAt, id };
}

/**
 * Prisma where: filtrlar SQL da (JS slice yo'q). Keyset: soldAt DESC, id DESC
 * — keyingi sahifa uchun «kichikroq» juftlik.
 */
export function saleHistoryWhere(
  filters: SaleHistoryFilters,
  cursor: SaleHistoryCursor | null,
): Prisma.SaleRecordWhereInput {
  const and: Prisma.SaleRecordWhereInput[] = [];

  if (filters.managerId) {
    and.push({ managerId: filters.managerId });
  }
  if (filters.from) {
    and.push({ soldAt: { gte: filters.from } });
  }
  if (filters.to) {
    and.push({ soldAt: { lte: filters.to } });
  }
  if (filters.customerQ) {
    and.push({
      customerName: { contains: filters.customerQ, mode: "insensitive" },
    });
  }
  if (filters.returned === "yes") {
    and.push({ returnedAt: { not: null } });
  } else if (filters.returned === "no") {
    and.push({ returnedAt: null });
  }

  if (cursor) {
    // (soldAt, id) < (c.soldAt, c.id) in DESC order:
    // soldAt < c.soldAt OR (soldAt = c.soldAt AND id < c.id)
    and.push({
      OR: [
        { soldAt: { lt: cursor.soldAt } },
        { soldAt: cursor.soldAt, id: { lt: cursor.id } },
      ],
    });
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0];
  return { AND: and };
}

export type SaleHistoryRow = {
  id: string;
  customerName: string;
  customerContact: string | null;
  targetType: string;
  qtySlabs: number | null;
  qtyAreaM2: { toString(): string } | null;
  price: { toString(): string } | null;
  soldAt: Date;
  returnedAt: Date | null;
  manager: { name: string };
  slab: {
    id: string;
    label: string;
    status: string;
    stoneType: { name: string };
  } | null;
  piece: {
    id: string;
    kind: string;
    status: string;
    stoneType: { name: string };
  } | null;
  batch: { stoneType: { name: string } } | null;
  /** TZ №15 — optional; null = legacy → derived DONE. */
  shipment: {
    cancelledAt: Date | null;
    completedAt: Date | null;
    lines: Array<{
      targetType: string;
      qtyOrderedSlabs: number | null;
      qtyOrderedAreaM2: { toString(): string } | null;
      qtyShippedSlabs: number;
      qtyShippedAreaM2: { toString(): string };
    }>;
  } | null;
};

export type SaleHistoryPage = {
  rows: SaleHistoryRow[];
  hasMore: boolean;
  /** hasMore ⟺ nextCursor !== null */
  nextCursor: string | null;
};

const SALE_INCLUDE = {
  manager: { select: { name: true } },
  slab: {
    select: {
      id: true,
      label: true,
      status: true,
      stoneType: { select: { name: true } },
    },
  },
  piece: {
    select: {
      id: true,
      kind: true,
      status: true,
      stoneType: { select: { name: true } },
    },
  },
  batch: { select: { stoneType: { select: { name: true } } } },
  shipment: {
    select: {
      cancelledAt: true,
      completedAt: true,
      lines: {
        select: {
          targetType: true,
          qtyOrderedSlabs: true,
          qtyOrderedAreaM2: true,
          qtyShippedSlabs: true,
          qtyShippedAreaM2: true,
        },
        take: 5,
      },
    },
  },
} as const;

/**
 * Bitta sahifa. take = pageSize + 1 → hasMore; kursor OXIRGI qaytarilgan
 * (pageSize-chi) qatordan — filtrlangan SQL tartibida, shuning uchun skip/dup yo'q.
 */
export async function fetchSaleHistoryPage(
  db: PrismaClient,
  args: {
    filters: SaleHistoryFilters;
    after?: string | null;
    pageSize?: number;
  },
): Promise<SaleHistoryPage> {
  const pageSize = args.pageSize ?? SALE_HISTORY_PAGE_SIZE;
  if (pageSize < 1) {
    return { rows: [], hasMore: false, nextCursor: null };
  }

  const cursor = parseSaleHistoryCursor(args.after ?? null);
  const where = saleHistoryWhere(args.filters, cursor);

  const fetched = await db.saleRecord.findMany({
    where,
    orderBy: [{ soldAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    include: SALE_INCLUDE,
  });

  const hasMore = fetched.length > pageSize;
  const rows = (hasMore ? fetched.slice(0, pageSize) : fetched) as SaleHistoryRow[];
  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeSaleHistoryCursor({ soldAt: last.soldAt, id: last.id })
      : null;

  return { rows, hasMore, nextCursor };
}

/** Query string → filters (sof). managerScope — saleHistoryAccess natijasi. */
export function filtersFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
  managerScope: string | null,
): SaleHistoryFilters {
  const one = (k: string): string => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const fromRaw = one("from");
  const toRaw = one("to");
  const retRaw = one("returned");
  let returned: SaleHistoryReturnedFilter = "all";
  if (retRaw === "yes" || retRaw === "1") returned = "yes";
  else if (retRaw === "no" || retRaw === "0") returned = "no";

  return {
    managerId: managerScope,
    from: fromRaw ? parseTashkentDayStart(fromRaw) : null,
    to: toRaw ? parseTashkentDayEnd(toRaw) : null,
    customerQ: one("q"),
    returned,
  };
}
