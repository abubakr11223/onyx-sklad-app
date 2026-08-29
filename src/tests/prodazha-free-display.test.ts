// W3-T4 (b, c) — шаг 2 «Продажи»:
//   (b) «свободно: ~-2 плит» не выводится — показ клампится в 0 той же
//       функцией, что подсказка /bron (computeFreeHint);
//   (c) остатки узоров считаются как count − sold и НЕ учитывают объёмные
//       продажи и брони партии — рядом появляется честная приписка, и только
//       когда такой объём действительно есть.
// page.tsx целиком не импортируется (Next server component) — только чистые
// хелперы; то же и в poisk-locations.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeFreeHint } from "@/app/bron/free-hint";
import {
  PATTERNS_VOLUME_NOTE,
  patternsVolumeNote,
} from "@/app/prodazha/page";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

describe("шаг 2 — «свободно» не показывает отрицательное (W3-T4 b)", () => {
  it("hold'ы больше остатка → 0 плит / 0 м², а не «~-2 плит»", () => {
    const shown = computeFreeHint({
      slabsFree: 1,
      areaFreeM2: 4,
      reservations: [{ qtySlabs: 3, qtyAreaM2: 10, expiresAt: FUTURE }],
      samples: [],
      now: NOW,
    });
    expect(shown.freeSlabs).toBe(0);
    expect(shown.freeAreaM2).toBe(0);
    // Строка, которую собирает page.tsx из этих чисел.
    expect(`~${shown.freeSlabs} плит`).toBe("~0 плит");
  });

  it("обычный случай не меняется: 10−3 плит / 50−12 м²", () => {
    const shown = computeFreeHint({
      slabsFree: 10,
      areaFreeM2: 50,
      reservations: [{ qtySlabs: 3, qtyAreaM2: 12, expiresAt: FUTURE }],
      samples: [],
      now: NOW,
    });
    expect(shown.freeSlabs).toBe(7);
    expect(shown.freeAreaM2).toBe(38);
  });

  it("не отслеживаемое измерение (§3) остаётся null — строка его не печатает", () => {
    const shown = computeFreeHint({
      slabsFree: null,
      areaFreeM2: 5,
      reservations: [],
      samples: [],
      now: NOW,
    });
    expect(shown.freeSlabs).toBeNull();
  });
});

describe("приписка про узоры (W3-T4 c)", () => {
  const base = {
    hasPatterns: true,
    volumeSoldSlabs: 0,
    volumeSoldAreaM2: 0,
    holdSlabs: 0,
    holdAreaM2: 0,
  };

  it("нет объёмных продаж и броней → приписки нет", () => {
    expect(patternsVolumeNote(base)).toBe("");
  });

  it("есть НЕузорная объёмная продажа партии → приписка есть", () => {
    expect(patternsVolumeNote({ ...base, volumeSoldSlabs: 2 })).toBe(
      PATTERNS_VOLUME_NOTE,
    );
    expect(patternsVolumeNote({ ...base, volumeSoldAreaM2: 6.5 })).toBe(
      PATTERNS_VOLUME_NOTE,
    );
  });

  it("есть бронь/образец на объём → приписка есть", () => {
    expect(patternsVolumeNote({ ...base, holdSlabs: 3 })).toBe(
      PATTERNS_VOLUME_NOTE,
    );
    expect(patternsVolumeNote({ ...base, holdAreaM2: 12 })).toBe(
      PATTERNS_VOLUME_NOTE,
    );
  });

  it("у партии нет узоров → приписки нет, даже при объёмных продажах", () => {
    expect(
      patternsVolumeNote({
        ...base,
        hasPatterns: false,
        volumeSoldSlabs: 5,
        holdSlabs: 2,
      }),
    ).toBe("");
  });

  it("текст короткий, русский и не тревожный", () => {
    expect(PATTERNS_VOLUME_NOTE).toBe(
      " · узоры показаны без учёта объёмных продаж и броней",
    );
  });
});

// Продажа «из узора» инкрементит СРАЗУ два счётчика (src/lib/sales.ts):
// batch.slabsSoldDirect/areaSoldDirectM2 и pattern.slabsSold/areaSoldM2.
// Поэтому в приписку идёт только НЕузорная часть — как в page.tsx.
function noteForBatch(b: {
  slabsSoldDirect: number;
  areaSoldDirectM2: number;
  holdSlabs?: number;
  holdAreaM2?: number;
  patterns: { slabsSold: number; areaSoldM2: number }[];
}): string {
  const patternsSoldSlabs = b.patterns.reduce((s, p) => s + p.slabsSold, 0);
  const patternsSoldAreaM2 = b.patterns.reduce((s, p) => s + p.areaSoldM2, 0);
  return patternsVolumeNote({
    hasPatterns: b.patterns.length > 0,
    volumeSoldSlabs: Math.max(0, b.slabsSoldDirect - patternsSoldSlabs),
    volumeSoldAreaM2: Math.max(0, b.areaSoldDirectM2 - patternsSoldAreaM2),
    holdSlabs: b.holdSlabs ?? 0,
    holdAreaM2: b.holdAreaM2 ?? 0,
  });
}

describe("продажа ИЗ узора не даёт ложной приписки (W3-T4 c, fix)", () => {
  it("партия 10 плит → узоры A(6)+B(4); продали 2 плиты узора A → приписки нет", () => {
    // sales.ts: batch.slabsSoldDirect += 2 И patternA.slabsSold += 2.
    expect(
      noteForBatch({
        slabsSoldDirect: 2,
        areaSoldDirectM2: 8,
        patterns: [
          { slabsSold: 2, areaSoldM2: 8 },
          { slabsSold: 0, areaSoldM2: 0 },
        ],
      }),
    ).toBe("");
  });

  it("продажи только по узорам, несколько узоров → приписки нет", () => {
    expect(
      noteForBatch({
        slabsSoldDirect: 5,
        areaSoldDirectM2: 20.4,
        patterns: [
          { slabsSold: 3, areaSoldM2: 12.4 },
          { slabsSold: 2, areaSoldM2: 8 },
        ],
      }),
    ).toBe("");
  });

  it("объёмная продажа МИМО узоров → приписка есть", () => {
    expect(
      noteForBatch({
        slabsSoldDirect: 5,
        areaSoldDirectM2: 20,
        patterns: [{ slabsSold: 2, areaSoldM2: 8 }],
      }),
    ).toBe(PATTERNS_VOLUME_NOTE);
  });

  it("продажа по узору + бронь на объём → приписка есть (бронь по узорам не раскладывается)", () => {
    expect(
      noteForBatch({
        slabsSoldDirect: 2,
        areaSoldDirectM2: 8,
        holdSlabs: 3,
        patterns: [{ slabsSold: 2, areaSoldM2: 8 }],
      }),
    ).toBe(PATTERNS_VOLUME_NOTE);
  });

  it("узор удалён после продажи → остаток отрицательным не считаем (клампим в 0)", () => {
    expect(
      noteForBatch({
        slabsSoldDirect: 0,
        areaSoldDirectM2: 0,
        patterns: [{ slabsSold: 2, areaSoldM2: 8 }],
      }),
    ).toBe("");
  });
});

describe("/prodazha page.tsx — показ отделён от охраны", () => {
  const src = readFileSync(
    path.join(process.cwd(), "src/app/prodazha/page.tsx"),
    "utf8",
  );

  it("строка «свободно» собирается из клампнутых значений", () => {
    expect(src).toContain("`~${shown.freeSlabs} плит`");
    expect(src).not.toContain("`~${netSlabs} плит`");
  });

  it("hasFree (охрана выбора) по-прежнему считает по сырым net*", () => {
    expect(src).toContain("(netSlabs !== null && netSlabs > 0)");
    expect(src).toContain("(netAreaM2 !== null && netAreaM2 > 0)");
  });

  it("остаток узора считается прежней формулой (новой математики нет)", () => {
    expect(src).toContain("const remSlabs = pat.slabsCount - pat.slabsSold;");
  });

  it("в приписку идёт объём МИМО узоров (продажи из узора вычтены)", () => {
    expect(src).toContain(
      "volumeSoldSlabs: Math.max(0, b.slabsSoldDirect - patternsSoldSlabs),",
    );
    expect(src).toContain("Number(b.areaSoldDirectM2) - patternsSoldAreaM2,");
    expect(src).not.toContain("volumeSoldSlabs: b.slabsSoldDirect,");
  });
});
