// ТЗ №20 H (§9.3) — счётчик сканирований /k/<код>.
//
// Что считаем: открытия карточки клиентом без входа и партнёром. Сотрудника
// НЕ считаем: он открывает карточки по работе (проверить, продать, напечатать
// этикетку), и его открытия забили бы «Чаще всего сканируют» складскими
// хлопотами, а владельцу нужен интерес покупателей. Партнёр — внешний интерес,
// поэтому считается.
//
// Как храним: дневной агрегат StoneCodeScan (код + день по Ташкенту → count).
// INSERT … ON CONFLICT DO UPDATE count = count + 1 — атомарно, без гонок, и
// таблица растёт не быстрее «кодов × дней», а не на каждое открытие.
// Сбой счётчика страницу не роняет (лог и дальше).

import type { PrismaClient } from "@prisma/client";
import type { CardViewer } from "./public-card";
import type { StoneCodeKind } from "./stone-code";
import { todayTashkentISO } from "./datetime";

/** Считать ли это открытие. */
export function shouldCountScan(viewer: CardViewer): boolean {
  return viewer === "client" || viewer === "partner";
}

/** День по Ташкенту как Date для колонки @db.Date (полночь UTC того же числа). */
export function scanDay(now: Date): Date {
  return new Date(`${todayTashkentISO(now)}T00:00:00.000Z`);
}

/** +1 к счётчику кода за сегодня. Никогда не бросает. */
export async function recordScan(
  db: Pick<PrismaClient, "$executeRaw">,
  args: { code: string; stoneTypeId: string; viewer: CardViewer; now?: Date },
): Promise<boolean> {
  if (!shouldCountScan(args.viewer)) return false;
  const day = scanDay(args.now ?? new Date());
  try {
    await db.$executeRaw`
      INSERT INTO "StoneCodeScan" ("code", "day", "stoneTypeId", "count", "updatedAt")
      VALUES (${args.code}, ${day}::date, ${args.stoneTypeId}, 1, NOW())
      ON CONFLICT ("code", "day")
      DO UPDATE SET "count" = "StoneCodeScan"."count" + 1, "updatedAt" = NOW()
    `;
    return true;
  } catch (e) {
    console.warn("[stone-scans] счётчик не записан:", e);
    return false;
  }
}

export interface TopScanRow {
  code: string;
  stoneTypeId: string;
  stoneName: string;
  /** Что за код (вид / партия / узор / плита / бой) — подпись в «Сводке». */
  kind: StoneCodeKind | null;
  scans: number;
}

export const TOP_SCANS_LIMIT = 10;

/**
 * Топ кодов по открытиям за период [from, toExclusive) (Ташкентские дни).
 * null-границы — за всё время. Порядок: больше открытий, затем код.
 */
export async function loadTopScans(
  db: Pick<PrismaClient, "stoneCodeScan" | "stoneType" | "batch" | "batchPattern" | "slab" | "piece">,
  period: { from: Date | null; toExclusive: Date | null },
  limit = TOP_SCANS_LIMIT,
): Promise<TopScanRow[]> {
  const where =
    period.from && period.toExclusive
      ? { day: { gte: scanDay(period.from), lt: scanDay(period.toExclusive) } }
      : {};
  const groups = await db.stoneCodeScan.groupBy({
    by: ["code", "stoneTypeId"],
    where,
    _sum: { count: true },
    orderBy: [{ _sum: { count: "desc" } }, { code: "asc" }],
    take: limit,
  });
  if (groups.length === 0) return [];
  const codes = groups.map((g) => g.code);
  const typeIds = [...new Set(groups.map((g) => g.stoneTypeId))];
  const sel = { where: { code: { in: codes } }, select: { code: true } } as const;
  const [types, batches, patterns, slabs, pieces] = await Promise.all([
    db.stoneType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true, code: true } }),
    db.batch.findMany(sel),
    db.batchPattern.findMany(sel),
    db.slab.findMany(sel),
    db.piece.findMany(sel),
  ]);
  const kindOf = new Map<string, StoneCodeKind>();
  for (const t of types) kindOf.set(t.code, "STONE_TYPE");
  for (const b of batches) kindOf.set(b.code, "BATCH");
  for (const p of patterns) kindOf.set(p.code, "PATTERN");
  for (const s of slabs) kindOf.set(s.code, "SLAB");
  for (const p of pieces) kindOf.set(p.code, "PIECE");
  const nameOf = new Map(types.map((t) => [t.id, t.name]));
  return groups.map((g) => ({
    code: g.code,
    stoneTypeId: g.stoneTypeId,
    stoneName: nameOf.get(g.stoneTypeId) ?? "—",
    kind: kindOf.get(g.code) ?? null,
    scans: g._sum.count ?? 0,
  }));
}
