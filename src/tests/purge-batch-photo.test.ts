// W2-T5 — регрессия ТЗ №16 B: Photo.batchId (фото партии целиком, Restrict).
//
// 2026-08: scope=A/B падал на `Photo_batchId_fkey` — фильтр Photo в purge.ts
// не знал о новом «владельце» фото (batchId), фото партии выживали шаг
// удаления Photo, и deleteMany по Batch откатывал всю транзакцию.
//
// БД НЕ нужна (как purge.test.ts), но fake здесь СЕМАНТИЧЕСКИЙ: он реально
// применяет where к in-memory строкам Photo и воспроизводит Restrict-FK
// Batch ← Photo.batchId. Без ветки { batchId } в photoWhere эти тесты падают
// той же ошибкой FK, что и боевая база.
import { describe, expect, it } from "vitest";
import {
  PURGE_DELETE_ORDER,
  executePurge,
  planPurge,
  type PurgeDb,
} from "@/lib/purge";

interface PhotoRow {
  id: string;
  stoneTypeId?: string;
  slabId?: string;
  batchId?: string;
}

interface Fixture {
  stones: Array<{ id: string; name: string; qrSlug: string }>;
  batches: Array<{ id: string; stoneTypeId: string }>;
  photos: PhotoRow[];
}

/** where-ветки Photo, которые использует purge.ts (OR-список). */
type PhotoWhere = {
  OR?: Array<{
    stoneTypeId?: { in: string[] };
    batchId?: { in: string[] };
    slab?: { stoneTypeId: { in: string[] } };
    piece?: unknown;
    photoRequest?: unknown;
    batchPattern?: unknown;
  }>;
};

function makeSemanticDb(fx: Fixture) {
  // Живое состояние — deleteMany реально удаляет строки.
  const state = {
    stones: [...fx.stones],
    batches: [...fx.batches],
    photos: [...fx.photos],
  };

  const photoMatches = (p: PhotoRow, where: PhotoWhere | undefined): boolean => {
    if (!where || !where.OR) return true; // {} = все (scope C)
    return where.OR.some((br) => {
      if (br.stoneTypeId?.in) {
        return p.stoneTypeId !== undefined && br.stoneTypeId.in.includes(p.stoneTypeId);
      }
      if (br.batchId?.in) {
        return p.batchId !== undefined && br.batchId.in.includes(p.batchId);
      }
      if (br.slab) {
        return false; // фикстура без плит — фото плит нет
      }
      // piece / photoRequest / batchPattern — в фикстуре таких фото нет
      return false;
    });
  };

  const batchMatches = (
    b: { id: string; stoneTypeId: string },
    where: { stoneTypeId?: { in: string[] } } | undefined,
  ): boolean => {
    if (!where || !where.stoneTypeId) return true;
    return where.stoneTypeId.in.includes(b.stoneTypeId);
  };

  const zeroModel = {
    count: async () => 0,
    deleteMany: async () => ({ count: 0 }),
  };

  const db: PurgeDb = {
    stoneType: {
      findMany: async () => state.stones,
      count: async ({ where } = {}) => {
        const w = where as { id?: { in: string[] } } | undefined;
        if (w?.id?.in) {
          return state.stones.filter((s) => w.id!.in.includes(s.id)).length;
        }
        return state.stones.length;
      },
      deleteMany: async ({ where } = {}) => {
        const w = where as { id?: { in: string[] } } | undefined;
        const gone = state.stones.filter((s) => !w?.id?.in || w.id.in.includes(s.id));
        state.stones = state.stones.filter((s) => !gone.includes(s));
        return { count: gone.length };
      },
    },
    batch: {
      findMany: async ({ where } = { select: { id: true } }) => {
        const w = where as { stoneTypeId?: { in: string[] } } | undefined;
        return state.batches
          .filter((b) => batchMatches(b, w))
          .map((b) => ({ id: b.id }));
      },
      count: async ({ where } = {}) =>
        state.batches.filter((b) =>
          batchMatches(b, where as { stoneTypeId?: { in: string[] } } | undefined),
        ).length,
      deleteMany: async ({ where } = {}) => {
        const w = where as { stoneTypeId?: { in: string[] } } | undefined;
        const gone = state.batches.filter((b) => batchMatches(b, w));
        // ⛔ Restrict-FK как в Postgres: живое фото с batchId на удаляемую
        // партию рушит удаление (Photo_batchId_fkey).
        for (const b of gone) {
          if (state.photos.some((p) => p.batchId === b.id)) {
            throw new Error(
              `Foreign key constraint violated: \`Photo_batchId_fkey\` (batch ${b.id})`,
            );
          }
        }
        state.batches = state.batches.filter((b) => !gone.includes(b));
        return { count: gone.length };
      },
    },
    photo: {
      count: async ({ where } = {}) =>
        state.photos.filter((p) => photoMatches(p, where as PhotoWhere)).length,
      deleteMany: async ({ where } = {}) => {
        const gone = state.photos.filter((p) => photoMatches(p, where as PhotoWhere));
        state.photos = state.photos.filter((p) => !gone.includes(p));
        return { count: gone.length };
      },
    },
    batchLocation: zeroModel,
    batchPattern: zeroModel,
    slab: { ...zeroModel, updateMany: async () => ({ count: 0 }) },
    piece: zeroModel,
    reservation: zeroModel,
    saleRecord: zeroModel,
    debt: zeroModel,
    photoRequest: {
      count: async () => 0,
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
    },
    photoDispatch: zeroModel,
    lead: zeroModel,
    shipmentLine: zeroModel,
    shipment: zeroModel,
    showroomPlacement: zeroModel,
    sample: zeroModel,
    auditLog: {
      count: async () => 0,
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
    mutationReceipt: zeroModel,
    $transaction: async (fn) => fn(db),
  };

  return { db, state };
}

/** Демо-камень + реальный камень, у каждого партия с фото партии (ТЗ №16 B). */
function fixtureWithBatchPhotos(): Fixture {
  return {
    stones: [
      { id: "st-demo", name: "Оникс Медовый (демо)", qrSlug: "demo-onyx" },
      { id: "st-real", name: "Мрамор Сицилия", qrSlug: "mramor-sicilia" },
    ],
    batches: [
      { id: "b-demo", stoneTypeId: "st-demo" },
      { id: "b-real", stoneTypeId: "st-real" },
    ],
    photos: [
      // фото партии целиком (ТЗ №16 B) — Restrict на Batch
      { id: "ph-batch-demo-1", batchId: "b-demo" },
      { id: "ph-batch-demo-2", batchId: "b-demo" },
      { id: "ph-batch-real", batchId: "b-real" },
      // каталожное фото вида камня (для полноты сцены)
      { id: "ph-stone-demo", stoneTypeId: "st-demo" },
      { id: "ph-stone-real", stoneTypeId: "st-real" },
    ],
  };
}

describe("purge — фото партии (Photo.batchId, ТЗ №16 B)", () => {
  it("PURGE_DELETE_ORDER: Photo строго раньше Batch (Restrict)", () => {
    const photoIdx = PURGE_DELETE_ORDER.indexOf("photo");
    const batchIdx = PURGE_DELETE_ORDER.indexOf("batch");
    expect(photoIdx).toBeGreaterThanOrEqual(0);
    expect(photoIdx).toBeLessThan(batchIdx);
  });

  it("scope A: проходит без FK-ошибки; фото чужих партий выживают", async () => {
    const { db, state } = makeSemanticDb(fixtureWithBatchPhotos());

    const result = await executePurge(db, "A", () => {});

    // 2 фото партии b-demo + 1 каталожное st-demo
    expect(result.deleted.photos).toBe(3);
    expect(result.deleted.batches).toBe(1);
    expect(result.deleted.stoneTypes).toBe(1);

    // Вне охвата — живы: партия и фото реального камня
    expect(state.batches.map((b) => b.id)).toEqual(["b-real"]);
    expect(state.photos.map((p) => p.id).sort()).toEqual([
      "ph-batch-real",
      "ph-stone-real",
    ]);
  });

  it("scope B: проходит без FK-ошибки; удаляет фото всех партий", async () => {
    const { db, state } = makeSemanticDb(fixtureWithBatchPhotos());

    const result = await executePurge(db, "B", () => {});

    expect(result.deleted.photos).toBe(5);
    expect(result.deleted.batches).toBe(2);
    expect(state.photos).toEqual([]);
    expect(state.batches).toEqual([]);
  });

  it("dry-run (planPurge) считает фото партии — счёт совпадает с executePurge", async () => {
    // Один и тот же fixture: сначала план (ничего не трогает), потом execute.
    const planned = makeSemanticDb(fixtureWithBatchPhotos());
    const planA = await planPurge(planned.db, "A");
    expect(planA.counts.photos).toBe(3);
    // planPurge — только count, состояние нетронуто
    expect(planned.state.photos).toHaveLength(5);

    const resultA = await executePurge(planned.db, "A", () => {});
    expect(resultA.deleted.photos).toBe(planA.counts.photos);

    const plannedB = makeSemanticDb(fixtureWithBatchPhotos());
    const planB = await planPurge(plannedB.db, "B");
    const resultB = await executePurge(plannedB.db, "B", () => {});
    expect(planB.counts.photos).toBe(5);
    expect(resultB.deleted.photos).toBe(planB.counts.photos);
  });

  it("scope A: партия без фото партии — счёт фото не завышен", async () => {
    const fx = fixtureWithBatchPhotos();
    fx.photos = fx.photos.filter((p) => p.batchId !== "b-demo");
    const { db } = makeSemanticDb(fx);
    const plan = await planPurge(db, "A");
    // только каталожное фото демо-камня
    expect(plan.counts.photos).toBe(1);
    const result = await executePurge(db, "A", () => {});
    expect(result.deleted.photos).toBe(1);
  });
});
