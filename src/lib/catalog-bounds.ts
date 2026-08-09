// Cap unbounded warehouse catalog loads (audit 2026-08-07 / round2).
// Pickers: take + explicit «N of M» notice + optional name filter — never silent truncate.
// Lists: compound keyset like sale-history / debts (no timestamp-only cursor).
//
// Caps are high enough that today's small warehouse looks unchanged; at seed
// scale (1000 types / 50k slabs) pages stay memory-bounded.

import type { Prisma } from "@prisma/client";

/** Top-level stone types for sale/reserve pickers. */
export const CATALOG_STONE_TYPES_CAP = 150;
/** Named slabs (AVAILABLE/RESERVED) on /razbit and nested under types. */
export const CATALOG_SLABS_CAP = 400;
/** Batches for direct break / volume pickers. */
export const CATALOG_BATCHES_CAP = 300;
/** Offcut/broken pieces under a stone type. */
export const CATALOG_PIECES_CAP = 400;
/** Active reservations list page size (/bron). */
export const ACTIVE_RESERVATIONS_PAGE_SIZE = 40;

/**
 * After `findMany({ take: cap + 1 })`: keep at most `cap`, flag overflow.
 * Pure — unit-tested; used by all three catalog pages.
 */
export function takeCapPlusOne<T>(
  rows: readonly T[],
  cap: number,
): { items: T[]; truncated: boolean; shown: number } {
  if (cap < 1) {
    return { items: [], truncated: rows.length > 0, shown: 0 };
  }
  if (rows.length > cap) {
    return { items: rows.slice(0, cap) as T[], truncated: true, shown: cap };
  }
  return { items: [...rows], truncated: false, shown: rows.length };
}

/** Prisma take for cap+1 detection. */
export function takeForCap(cap: number): number {
  return Math.max(1, cap) + 1;
}

/**
 * User-visible truncation copy (RU). Tests assert this is non-empty when truncated.
 */
export function catalogCapNoticeRu(args: {
  /** e.g. «плит», «партий», «видов камня», «активных броней» */
  what: string;
  shown: number;
  total: number;
}): string {
  return `Показано ${args.shown} из ${args.total} ${args.what}. Уточните поиск (поле выше), чтобы найти остальные — полный список не загружается целиком.`;
}

export function isCapNoticeVisible(truncated: boolean, total: number, shown: number): boolean {
  return truncated && total > shown;
}

// ───────────── Active reservations keyset (expiresAt ASC, id ASC) ─────────────
// Summary list on /bron — paginate with compound cursor (sale-history shape).

export type ExpiresIdCursor = {
  expiresAt: Date;
  id: string;
};

/** `` `${expiresAt.toISOString()}_${id}` `` */
export function encodeExpiresIdCursor(c: ExpiresIdCursor): string {
  return `${c.expiresAt.toISOString()}_${c.id}`;
}

export function parseExpiresIdCursor(
  raw: string | null | undefined,
): ExpiresIdCursor | null {
  if (!raw) return null;
  const s = raw.trim();
  const i = s.indexOf("_");
  if (i <= 0) return null;
  const iso = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!id) return null;
  const expiresAt = new Date(iso);
  if (Number.isNaN(expiresAt.getTime())) return null;
  return { expiresAt, id };
}

/**
 * Next page in ASC order (expiresAt, id):
 *   expiresAt > c OR (expiresAt = c AND id > c.id)
 */
export function afterExpiresIdKeyset(
  cursor: ExpiresIdCursor,
): Prisma.ReservationWhereInput {
  return {
    OR: [
      { expiresAt: { gt: cursor.expiresAt } },
      { expiresAt: cursor.expiresAt, id: { gt: cursor.id } },
    ],
  };
}

/**
 * Name filter for catalog pickers (stone type). Empty → no filter.
 */
export function stoneNameContainsFilter(
  q: string | null | undefined,
): Prisma.StoneTypeWhereInput | undefined {
  const t = (q ?? "").trim();
  if (!t) return undefined;
  return { name: { contains: t, mode: "insensitive" } };
}
