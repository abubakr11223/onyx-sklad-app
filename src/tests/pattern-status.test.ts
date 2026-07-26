// ТЗ №3 §2 — статус узор-подгруппы (вычисляемый из остатка). Чистая логика.
import { describe, expect, it } from "vitest";
import {
  clampPatternRemainder,
  patternStatus,
  PATTERN_STATUS_RU,
} from "@/lib/pattern-status";

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

describe("clampPatternRemainder — display clamp по batch-free (ТЗ №7 #20)", () => {
  const PAT = { slabsCount: 5, slabsSold: 0, areaM2: 25, areaSoldM2: 0 };

  it("узор больше batch-free → clamp: показываем не больше свободного остатка партии", async () => {
    // Классический сценарий аудита: узор 5 плит, но в партии свободно 3 (из-за
    // прямого боя или выделения плит, не приписанных узору).
    const clamped = clampPatternRemainder(PAT, { slabsFree: 3, areaFreeM2: 15 });
    expect(clamped.slabsRemaining).toBe(3);
    expect(clamped.areaRemainingM2).toBe(15);
  });

  it("узор меньше batch-free → показываем узор-остаток без изменений", async () => {
    const clamped = clampPatternRemainder(PAT, { slabsFree: 20, areaFreeM2: 100 });
    expect(clamped.slabsRemaining).toBe(5);
    expect(clamped.areaRemainingM2).toBe(25);
  });

  it("batch-free null (учёт по измерению отключён) → узор-остаток без clamp", async () => {
    const clamped = clampPatternRemainder(PAT, {
      slabsFree: null,
      areaFreeM2: null,
    });
    expect(clamped.slabsRemaining).toBe(5);
    expect(clamped.areaRemainingM2).toBe(25);
  });

  it("отрицательный узор-остаток → 0 (UI НЕ показывает минус)", async () => {
    const sold = { slabsCount: 5, slabsSold: 7, areaM2: 25, areaSoldM2: 30 };
    const clamped = clampPatternRemainder(sold, {
      slabsFree: 10,
      areaFreeM2: 50,
    });
    expect(clamped.slabsRemaining).toBe(0);
    expect(clamped.areaRemainingM2).toBe(0);
  });

  it("отрицательный batch-free (гонка / bug) → 0 (не показываем минус)", async () => {
    const clamped = clampPatternRemainder(PAT, { slabsFree: -1, areaFreeM2: -0.5 });
    expect(clamped.slabsRemaining).toBe(0);
    expect(clamped.areaRemainingM2).toBe(0);
  });

  it("узор-остаток по площади ≤ batch-free по площади, но по плитам БОЛЬШЕ → clamp только по плитам", async () => {
    // Иногда одна размерность узкая, другая широкая — clamp per-dimension.
    const clamped = clampPatternRemainder(PAT, {
      slabsFree: 2, // clamp по плитам
      areaFreeM2: 100, // не clamp по площади (узор всё равно даст 25)
    });
    expect(clamped.slabsRemaining).toBe(2);
    expect(clamped.areaRemainingM2).toBe(25);
  });
});
