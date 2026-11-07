// ТЗ №20 I (§10.1) — «нужный размер» в каталоге = ТА ЖЕ логика, что «Поиск».
//
// Своего расчёта здесь нет: те же where-строители (slabsWhere /
// batchesPlateWhere — запас на рез CUTTING_MARGIN 2 см, поворот заготовки),
// тот же отбор узоров sizeSearchHits (pieceFitsRequest) и тот же итоговый
// набор видов plateFitStoneTypeIds, которым /poisk фильтрует «Целые плиты и
// партии». Те же порядок и предел строк, что у страницы /poisk, — поэтому на
// одном и том же складе каталог и «Поиск» дают один и тот же список видов.
//
// Бой/остатки (Piece) в «Поиске» идут отдельным блоком «предложить первыми» и
// список видов не фильтруют — каталог (виды камня) их тоже не учитывает.

import type { PrismaClient } from "@prisma/client";
import { CUTTING_MARGIN_MM } from "./inventory";
import {
  batchesPlateWhere,
  plateFitStoneTypeIds,
  sizeSearchHits,
  slabsWhere,
  type SizeSearchBatch,
} from "./poisk-search";

/** Предел строк плит/партий под размер — общий для /poisk и каталога. */
export const POISK_SIZE_MAX_ROWS = 500;

/**
 * Размер из строки запроса — семантика /poisk (parseInt, только > 0):
 * «120.5» → 120, «abc» / «0» / пусто → null.
 */
export function parsePoiskDim(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** needMax / needMin с запасом на рез — как в /poisk/page.tsx. */
export function poiskNeed(lengthCm: number, widthCm: number): { needMax: number; needMin: number } {
  return {
    needMax: Math.max(lengthCm, widthCm) + CUTTING_MARGIN_MM,
    needMin: Math.min(lengthCm, widthCm) + CUTTING_MARGIN_MM,
  };
}

type SizeFitDb = Pick<PrismaClient, "slab" | "batch">;

/**
 * Виды, у которых есть целая плита, узор или однородная партия под размер
 * L×W (см). `q` — тот же material-фильтр «Поиска» (пусто — все виды).
 */
export async function loadPlateFitStoneTypeIds(
  db: SizeFitDb,
  args: { q?: string; lengthCm: number; widthCm: number },
): Promise<Set<string>> {
  const q = args.q ?? "";
  const { needMax, needMin } = poiskNeed(args.lengthCm, args.widthCm);
  const [slabs, batches] = await Promise.all([
    db.slab.findMany({
      where: slabsWhere(q, needMax, needMin),
      select: { id: true, stoneType: { select: { id: true } } },
      orderBy: [{ lengthMm: "asc" }, { widthMm: "asc" }, { id: "asc" }],
      take: POISK_SIZE_MAX_ROWS,
    }),
    db.batch.findMany({
      where: batchesPlateWhere(q, needMax, needMin),
      select: {
        id: true,
        lengthMm: true,
        widthMm: true,
        thicknessMm: true,
        stoneType: { select: { id: true, name: true } },
        patterns: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            lengthMm: true,
            widthMm: true,
            thicknessMm: true,
            description: true,
          },
        },
        locations: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { block: true, landmark: true, slabsHere: true, batchPatternId: true },
        },
      },
      orderBy: [{ arrivedAt: "desc" }],
      take: POISK_SIZE_MAX_ROWS,
    }),
  ]);
  // Остаток здесь не нужен (набор видов от него не зависит) — map'ы null.
  const hits = sizeSearchHits(
    batches as unknown as SizeSearchBatch[],
    args.lengthCm,
    args.widthCm,
    null,
    null,
  );
  return plateFitStoneTypeIds(slabs, hits);
}
