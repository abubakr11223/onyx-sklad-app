// W2-T1 — GENERATED ustunlarni tiklashda tashlab ketish (sof mantiq).
//
// Nega: Postgres GENERATED ALWAYS AS … STORED ustunga (Piece.boundingAreaMm2)
// INSERT'da ochiq qiymat qabul qilmaydi — tiklash aynan shu yerda yiqilardi.
// Ro'yxat information_schema'dan ish paytida olinadi, shuning uchun bu testlar
// nomni qattiq yozmasdan xaritalash va tozalash mantiqini tekshiradi.
import { describe, expect, it } from "vitest";
import {
  GENERATED_COLUMNS_SQL,
  buildGeneratedColumnMap,
  stripGeneratedColumns,
} from "@/lib/restore";

describe("GENERATED_COLUMNS_SQL", () => {
  it("joriy sxemadagi GENERATED va IDENTITY ustunlarni so'raydi", () => {
    expect(GENERATED_COLUMNS_SQL).toContain("information_schema.columns");
    expect(GENERATED_COLUMNS_SQL).toContain("current_schema()");
    expect(GENERATED_COLUMNS_SQL).toContain("is_generated = 'ALWAYS'");
    expect(GENERATED_COLUMNS_SQL).toContain("identity_generation = 'ALWAYS'");
  });
});

describe("buildGeneratedColumnMap", () => {
  it("jadval nomi (PascalCase) delegate nomiga (camelCase) bog'lanadi", () => {
    const map = buildGeneratedColumnMap([
      { table_name: "Piece", column_name: "boundingAreaMm2" },
    ]);
    expect(map).toEqual({ piece: ["boundingAreaMm2"] });
  });

  it("bir jadvalda bir nechta generated ustun yig'iladi", () => {
    const map = buildGeneratedColumnMap([
      { table_name: "Piece", column_name: "boundingAreaMm2" },
      { table_name: "Piece", column_name: "kelajakdagiUstun" },
      { table_name: "BatchLocation", column_name: "hisoblangan" },
    ]);
    expect(map.piece).toEqual(["boundingAreaMm2", "kelajakdagiUstun"]);
    expect(map.batchLocation).toEqual(["hisoblangan"]);
  });

  it("tiklash tartibida yo'q jadval (xizmat jadvallari) tushib qoladi", () => {
    const map = buildGeneratedColumnMap([
      { table_name: "LoginAttempt", column_name: "x" },
      { table_name: "_prisma_migrations", column_name: "y" },
    ]);
    expect(map).toEqual({});
  });

  it("bo'sh natija — bo'sh xarita (generated ustunsiz sxema ham ishlaydi)", () => {
    expect(buildGeneratedColumnMap([])).toEqual({});
  });
});

describe("stripGeneratedColumns", () => {
  it("generated ustun olib tashlanadi, qolganlari joyida qoladi", () => {
    const rows = [
      { id: "p1", boundingLengthMm: 100, boundingWidthMm: 50, boundingAreaMm2: 5000 },
      { id: "p2", boundingLengthMm: 30, boundingWidthMm: 20, boundingAreaMm2: 600 },
    ];
    const out = stripGeneratedColumns(rows, ["boundingAreaMm2"]);
    expect(out).toEqual([
      { id: "p1", boundingLengthMm: 100, boundingWidthMm: 50 },
      { id: "p2", boundingLengthMm: 30, boundingWidthMm: 20 },
    ]);
  });

  it("kirish massiviga tegmaydi (snapshot qayta ishlatilishi mumkin)", () => {
    const rows = [{ id: "p1", boundingAreaMm2: 5000 }];
    stripGeneratedColumns(rows, ["boundingAreaMm2"]);
    expect(rows[0]).toEqual({ id: "p1", boundingAreaMm2: 5000 });
  });

  it("ustun ro'yxati bo'sh — o'sha massivning o'zi qaytadi", () => {
    const rows = [{ id: "p1" }];
    expect(stripGeneratedColumns(rows, [])).toBe(rows);
  });

  it("yozuvda ustun bo'lmasa — yozuv o'zgarishsiz (eski format ham o'tadi)", () => {
    const rows = [{ id: "p1", block: "A" }];
    const out = stripGeneratedColumns(rows, ["boundingAreaMm2"]);
    expect(out[0]).toBe(rows[0]);
  });
});
