// Kunlik zaxira (src/lib/db-snapshot.ts) — sof modul, baza kerak emas.
//
// Eng muhim tekshiruv — TO'LIQLIK: sxemaga yangi model qo'shilса, u yo
// snapshot'ga kirishi, yo ataylab chiqarilganlar ro'yxatida bo'lishi kerak.
// Aks holda zaxira jim ravishda chala bo'lib qoladi va buni faqat tiklash
// paytida bilib qolamiz — ya'ni eng yomon paytda.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_EXCLUDED,
  SNAPSHOT_TABLES,
  buildSnapshot,
  snapshotCaption,
  snapshotFilename,
  snapshotToJson,
  snapshotTotalRows,
} from "@/lib/db-snapshot";

/** «StoneType» → «stoneType» (Prisma delegate nomi). */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function schemaModels(): string[] {
  const src = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  return [...src.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

describe("SNAPSHOT_TABLES — to'liqlik", () => {
  it("sxemadagi har bir model yo zaxirada, yo ataylab chiqarilgan", () => {
    const excluded = new Set<string>(SNAPSHOT_EXCLUDED);
    const inSnapshot = new Set<string>(SNAPSHOT_TABLES);
    const missing = schemaModels().filter(
      (m) => !excluded.has(m) && !inSnapshot.has(delegateName(m)),
    );
    expect(missing).toEqual([]);
  });

  it("chiqarilganlar zaxiraga tushib qolmagan", () => {
    const inSnapshot = new Set<string>(SNAPSHOT_TABLES);
    for (const m of SNAPSHOT_EXCLUDED) {
      expect(inSnapshot.has(delegateName(m))).toBe(false);
    }
  });

  it("takrorlanuvchi jadval yo'q", () => {
    expect(new Set(SNAPSHOT_TABLES).size).toBe(SNAPSHOT_TABLES.length);
  });
});

describe("buildSnapshot", () => {
  const TAKEN = "2026-08-24T21:00:00.000Z";

  function fakeClient(data: Record<string, unknown[]>) {
    const c: Record<string, { findMany: () => Promise<unknown[]> }> = {};
    for (const t of SNAPSHOT_TABLES) {
      c[t] = { findMany: async () => data[t] ?? [] };
    }
    return c;
  }

  it("hamma jadvalni o'qiydi, sanoq va yozuvlarni qaytaradi", async () => {
    const s = await buildSnapshot(
      fakeClient({ stoneType: [{ id: "st1" }], batch: [{ id: "b1" }, { id: "b2" }] }),
      TAKEN,
    );
    expect(s.version).toBe(1);
    expect(s.takenAt).toBe(TAKEN);
    expect(s.counts.stoneType).toBe(1);
    expect(s.counts.batch).toBe(2);
    expect(s.rows.batch).toEqual([{ id: "b1" }, { id: "b2" }]);
    expect(Object.keys(s.rows).sort()).toEqual([...SNAPSHOT_TABLES].sort());
  });

  it("client'da jadval bo'lmasa — bo'sh, lekin zaxira yiqilmaydi", async () => {
    const s = await buildSnapshot({ stoneType: { findMany: async () => [{ id: "x" }] } }, TAKEN);
    expect(s.counts.stoneType).toBe(1);
    expect(s.counts.batch).toBe(0);
    expect(s.rows.batch).toEqual([]);
  });

  it("bo'sh baza → 0 yozuv (bu ham to'g'ri holat, purge'dan keyin)", async () => {
    const s = await buildSnapshot(fakeClient({}), TAKEN);
    expect(snapshotTotalRows(s)).toBe(0);
  });
});

describe("snapshotToJson", () => {
  const TAKEN = "2026-08-24T21:00:00.000Z";

  it("BigInt JSON'ni yiqitmaydi — satrga aylanadi", async () => {
    const s = await buildSnapshot(
      { stoneType: { findMany: async () => [{ id: "a", n: BigInt(9007199254740993n) }] } },
      TAKEN,
    );
    const parsed = JSON.parse(snapshotToJson(s));
    expect(parsed.rows.stoneType[0].n).toBe("9007199254740993");
  });

  it("Decimal-ga o'xshash obyekt (toJSON) satr bo'lib chiqadi", async () => {
    const decimalLike = { toJSON: () => "12.500" };
    const s = await buildSnapshot(
      { batch: { findMany: async () => [{ id: "b", areaTotalM2: decimalLike }] } },
      TAKEN,
    );
    const parsed = JSON.parse(snapshotToJson(s));
    expect(parsed.rows.batch[0].areaTotalM2).toBe("12.500");
  });
});

describe("nom va izoh", () => {
  it("fayl nomi sana bo'yicha saralanadi", () => {
    expect(snapshotFilename("2026-08-24T21:00:00.000Z")).toBe(
      "onyx-backup-2026-08-24.json",
    );
  });

  it("izohda faqat bo'sh bo'lmagan jadvallar va jami sanoq", () => {
    const caption = snapshotCaption({
      version: 1,
      takenAt: "2026-08-24T21:00:00.000Z",
      counts: { stoneType: 3, batch: 5, slab: 0 },
      rows: {},
    });
    expect(caption).toContain("2026-08-24");
    expect(caption).toContain("Виды камня: 3");
    expect(caption).toContain("Партии: 5");
    expect(caption).not.toContain("Плиты");
    expect(caption).toContain("Всего записей: 8");
  });
});
