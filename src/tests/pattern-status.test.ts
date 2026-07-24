// ТЗ №3 §2 — статус узор-подгруппы (вычисляемый из остатка). Чистая логика.
import { describe, expect, it } from "vitest";
import { patternStatus, PATTERN_STATUS_RU } from "@/lib/pattern-status";

describe("patternStatus — статус подгруппы по остатку (ТЗ №3 §2)", () => {
  it("ничего не продано → AVAILABLE (в наличии)", () => {
    expect(
      patternStatus({ slabsCount: 50, slabsSold: 0, areaM2: 30, areaSoldM2: 0 }),
    ).toBe("AVAILABLE");
  });

  it("часть продана → PARTIAL (частично продан)", () => {
    expect(
      patternStatus({ slabsCount: 50, slabsSold: 20, areaM2: 30, areaSoldM2: 12 }),
    ).toBe("PARTIAL");
  });

  it("всё продано (плиты и м²) → SOLD (продан)", () => {
    expect(
      patternStatus({ slabsCount: 50, slabsSold: 50, areaM2: 30, areaSoldM2: 30 }),
    ).toBe("SOLD");
  });

  it("продажа только по м² (плиты не тронуты) → PARTIAL, не AVAILABLE", () => {
    expect(
      patternStatus({ slabsCount: 50, slabsSold: 0, areaM2: 30, areaSoldM2: 5 }),
    ).toBe("PARTIAL");
  });

  it("продажа только по плитам (м² не тронуты) → PARTIAL", () => {
    expect(
      patternStatus({ slabsCount: 50, slabsSold: 10, areaM2: 30, areaSoldM2: 0 }),
    ).toBe("PARTIAL");
  });

  it("двоичный шум м² у полностью проданного не мешает SOLD (эпсилон)", () => {
    // Остаток площади = -0.0000001 (float), плиты = 0 → всё равно продан.
    expect(
      patternStatus({
        slabsCount: 10,
        slabsSold: 10,
        areaM2: 0.1 + 0.2,
        areaSoldM2: 0.3,
      }),
    ).toBe("SOLD");
  });

  it("RU-подписи заданы для всех статусов", () => {
    expect(PATTERN_STATUS_RU.AVAILABLE).toBe("в наличии");
    expect(PATTERN_STATUS_RU.PARTIAL).toBe("частично продан");
    expect(PATTERN_STATUS_RU.SOLD).toBe("продан");
  });
});
