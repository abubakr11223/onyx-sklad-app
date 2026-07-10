// TG-C — фото «свежести» sof helperlari testlari (DB YO'Q).
// Normativ manba: TZ §5.3 (видна дата съёмки; фото старше нескольких месяцев —
// пометка «возможно, переснять»). Barcha sanalar QAT'IY belgilangan — test
// vaqtga bog'liq emas (hech qayerda argumentsiz `new Date()` yo'q).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHOTO_STALE_MONTHS,
  MAX_PHOTO_STALE_MONTHS,
  isPhotoStale,
  parsePhotoStaleMonthsConfig,
} from "@/lib/photos";

describe("parsePhotoStaleMonthsConfig — TZ §5.3 config", () => {
  it("to'g'ri qiymat parse qilinadi", () => {
    expect(parsePhotoStaleMonthsConfig("6")).toBe(6);
    expect(parsePhotoStaleMonthsConfig(" 3 ")).toBe(3);
    expect(parsePhotoStaleMonthsConfig("1")).toBe(1);
    expect(parsePhotoStaleMonthsConfig(String(MAX_PHOTO_STALE_MONTHS))).toBe(
      MAX_PHOTO_STALE_MONTHS,
    );
  });

  it("chin-buzuq (parseInt→NaN) / chegaradan tashqari qiymat → default 6", () => {
    // Bular parseInt uchun HAQIQIY NaN yoki chegaradan tashqari — mos kelib
    // qolgan emas: default'ni ishonchli sinaydi.
    expect(parsePhotoStaleMonthsConfig(null)).toBe(DEFAULT_PHOTO_STALE_MONTHS);
    expect(parsePhotoStaleMonthsConfig(undefined)).toBe(
      DEFAULT_PHOTO_STALE_MONTHS,
    );
    expect(parsePhotoStaleMonthsConfig("")).toBe(DEFAULT_PHOTO_STALE_MONTHS);
    expect(parsePhotoStaleMonthsConfig("abc")).toBe(DEFAULT_PHOTO_STALE_MONTHS);
    expect(parsePhotoStaleMonthsConfig("0")).toBe(DEFAULT_PHOTO_STALE_MONTHS);
    expect(parsePhotoStaleMonthsConfig("-2")).toBe(DEFAULT_PHOTO_STALE_MONTHS);
    expect(
      parsePhotoStaleMonthsConfig(String(MAX_PHOTO_STALE_MONTHS + 1)),
    ).toBe(DEFAULT_PHOTO_STALE_MONTHS);
  });

  it("parseInt kasr/qo'shimcha axlatni kesadi (reservationDays bilan bir xil idioma)", () => {
    // Diqqat: bu default'ga TUSHISH emas — parseInt butun qismini oladi.
    // Kesilgan qiymat default (6) dan FARQ qiladi — shuning uchun sinov halol.
    expect(parsePhotoStaleMonthsConfig("7.5")).toBe(7);
    expect(parsePhotoStaleMonthsConfig("8abc")).toBe(8);
  });
});

describe("isPhotoStale — «возможно, переснять» chegarasi (qat'iy)", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");
  const months = 6; // chegara: 2026-01-09

  it("aynan `months` oy oldin olingan foto → HALI eskirmagan (qat'iy <)", () => {
    const exactly = new Date("2026-01-09T12:00:00.000Z");
    expect(isPhotoStale(exactly, now, months)).toBe(false);
  });

  it("`months` + 1 kun oldin olingan foto → eskirgan", () => {
    const oneDayOlder = new Date("2026-01-08T12:00:00.000Z");
    expect(isPhotoStale(oneDayOlder, now, months)).toBe(true);
  });

  it("bugun olingan foto → eskirmagan", () => {
    expect(isPhotoStale(now, now, months)).toBe(false);
  });

  it("yaqinda (chegaradan keyin) olingan foto → eskirmagan", () => {
    const recent = new Date("2026-05-01T00:00:00.000Z");
    expect(isPhotoStale(recent, now, months)).toBe(false);
  });

  it("ancha eski (bir yil oldin) foto → eskirgan", () => {
    const old = new Date("2025-07-09T12:00:00.000Z");
    expect(isPhotoStale(old, now, months)).toBe(true);
  });

  it("oy uzunligi turlicha bo'lsa ham kun to'lib ketmaydi (31-mart − 1 oy)", () => {
    const endOfMarch = new Date("2026-03-31T12:00:00.000Z");
    // Chegara: 2026-02-28 (fevral 31-kuni yo'q → oy oxiriga qisiladi).
    // 28-fevralda olingan foto → hali eskirmagan (qat'iy <).
    expect(
      isPhotoStale(new Date("2026-02-28T12:00:00.000Z"), endOfMarch, 1),
    ).toBe(false);
    // 27-fevralda olingan → eskirgan.
    expect(
      isPhotoStale(new Date("2026-02-27T12:00:00.000Z"), endOfMarch, 1),
    ).toBe(true);
  });
});
