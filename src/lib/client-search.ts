// TZ №14 BUG-02 — единый поиск клиентов (справочник /klienty + форма продажи).
// Один WHERE-механизм: имя И телефон, partial, case-insensitive, пробелы.
// Без «третьего» разрозненного запроса — оба call-site отсюда.
//
// Pure where-builder unit-tested without DB. DB findMany is thin and bounded.

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  clientListScope,
  findClientByNormalizedPhone,
  normalizeClientPhone,
  type ClientType,
} from "@/lib/clients";

type Db = PrismaClient | Prisma.TransactionClient;

/** Hard cap — no unbounded findMany (project rule). */
export const CLIENT_SEARCH_MAX_TAKE = 50;
/** Sale form dropdown: tighter list for typing. */
export const CLIENT_SEARCH_SALE_TAKE = 20;

/**
 * Object picker in the sale form (objects of the chosen client).
 *
 * Живёт ЗДЕСЬ, а не рядом с действием: `client-actions.ts` помечен
 * «use server», и в таком модуле КАЖДЫЙ экспорт обязан быть async-функцией.
 * Экспорт простой константы оттуда ломает модуль целиком («The module has no
 * exports at all») и вместе с ним всю форму продажи.
 */
export const SITE_PICKER_TAKE = 50;

export type ClientSearchHit = {
  id: string;
  name: string;
  phone: string;
  type: ClientType;
};

/**
 * Normalize free-text search: trim + collapse internal whitespace.
 * «  Ти  мур  » → «Ти мур» (still won't match «Тимур» without translit —
 * see docs in result; this only fixes multi-space typing).
 */
export function normalizeClientSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Shared OR filters for Client search (name + phone).
 * Empty query → [] (caller should skip OR / return no rows).
 *
 *  - name: contains, mode insensitive (partial mid-string)
 *  - phone: contains raw string + contains digits-only when ≥3 digits
 */
export function clientSearchOrFilters(
  qRaw: string,
): Prisma.ClientWhereInput[] {
  const q = normalizeClientSearchQuery(qRaw);
  if (!q) return [];
  const digits = normalizeClientPhone(q);
  const or: Prisma.ClientWhereInput[] = [
    { name: { contains: q, mode: "insensitive" } },
    { phone: { contains: q } },
  ];
  if (digits.length >= 3) {
    or.push({ phone: { contains: digits } });
  }
  return or;
}

/**
 * Full Prisma `where` for directory-style client search:
 * scope (owner all / manager own) + optional type + OR name/phone.
 */
export function clientSearchWhere(args: {
  q: string;
  canSeeAllClients: boolean;
  actorId: string | null;
  type?: ClientType | "";
  managerId?: string;
}): Prisma.ClientWhereInput {
  const scope = clientListScope({
    canSeeAllClients: args.canSeeAllClients,
    actorId: args.actorId,
  });
  const where: Prisma.ClientWhereInput = { ...scope };
  if (args.type === "B2C" || args.type === "B2B") {
    where.type = args.type;
  }
  if (args.managerId?.trim() && args.canSeeAllClients) {
    where.managerId = args.managerId.trim();
  }
  const or = clientSearchOrFilters(args.q);
  if (or.length > 0) {
    where.OR = or;
  }
  return where;
}

function clampTake(take: number | undefined, fallback: number): number {
  return Math.min(
    CLIENT_SEARCH_MAX_TAKE,
    Math.max(1, take ?? fallback),
  );
}

/**
 * Shared DB search used by /klienty and sale form.
 *
 * `attachAnyExisting` (sale form): when the scoped list misses a real card
 * (e.g. owner-created client, manager sells), also run the same name/phone
 * OR globally and merge — bounded. Phone already had a global path; name
 * did not, which matched the warehouse symptom.
 */
export async function searchClients(
  db: Db,
  opts: {
    q: string;
    canSeeAllClients: boolean;
    actorId: string | null;
    take?: number;
    /** Sale: allow attaching a card outside manager scope (name + phone). */
    attachAnyExisting?: boolean;
    type?: ClientType | "";
    managerId?: string;
  },
): Promise<ClientSearchHit[]> {
  const q = normalizeClientSearchQuery(opts.q);
  if (!q) return [];

  const take = clampTake(opts.take, CLIENT_SEARCH_SALE_TAKE);
  const where = clientSearchWhere({
    q,
    canSeeAllClients: opts.canSeeAllClients,
    actorId: opts.actorId,
    type: opts.type,
    managerId: opts.managerId,
  });

  const rows = await db.client.findMany({
    where,
    orderBy: { name: "asc" },
    take,
    select: { id: true, name: true, phone: true, type: true },
  });

  const byId = new Map<string, ClientSearchHit>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      phone: r.phone,
      type: r.type as ClientType,
    });
  }

  if (opts.attachAnyExisting) {
    const digits = normalizeClientPhone(q);
    // Same OR filters, no manager scope — so name works like the old phone path.
    const globalOr = clientSearchOrFilters(q);
    if (globalOr.length > 0 && byId.size < take) {
      const more = await db.client.findMany({
        where: { OR: globalOr },
        orderBy: { name: "asc" },
        take,
        select: { id: true, name: true, phone: true, type: true },
      });
      for (const r of more) {
        if (byId.has(r.id)) continue;
        byId.set(r.id, {
          id: r.id,
          name: r.name,
          phone: r.phone,
          type: r.type as ClientType,
        });
        if (byId.size >= take) break;
      }
    }
    // Extra: normalized exact phone among recent cards (formatting variants).
    if (digits.length >= 7 && byId.size < take) {
      const candidates = await db.client.findMany({
        select: { id: true, name: true, phone: true, type: true },
        take: 500,
        orderBy: { createdAt: "desc" },
      });
      const exact = findClientByNormalizedPhone(candidates, q);
      if (exact && !byId.has(exact.id)) {
        const hit: ClientSearchHit = {
          id: exact.id,
          name: exact.name,
          phone: exact.phone,
          type: exact.type as ClientType,
        };
        // Prefer exact phone hit at front of list.
        const rest = [...byId.values()];
        byId.clear();
        byId.set(hit.id, hit);
        for (const c of rest) {
          if (byId.size >= take) break;
          byId.set(c.id, c);
        }
      }
    }
  }

  return [...byId.values()].slice(0, take);
}
