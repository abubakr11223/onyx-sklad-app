// W1-T1 — единая формула hold'ов объёма партии (брони + образцы), DB-siz.
// Контракт: активная (ACTIVE, не истёкшая) BATCH_VOLUME-бронь и активный
// BATCH_VOLUME-образец режут свободный остаток ОДИНАКОВО во всех потребителях
// (охрана продажи, охрана брони, витрина /prodazha шаг 2).
import { describe, expect, it } from "vitest";
import {
  EMPTY_BATCH_VOLUME_HOLDS,
  computeBatchVolumeHolds,
  findOwnActiveVolumeReservations,
  formatHoldQty,
} from "@/lib/volume-holds";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-28T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 24 * HOUR);
const PAST = new Date(NOW.getTime() - HOUR);

describe("computeBatchVolumeHolds — брони + образцы (W1-T1)", () => {
  it("пусто → нулевой hold", () => {
    expect(
      computeBatchVolumeHolds({ reservations: [], samples: [], now: NOW }),
    ).toEqual(EMPTY_BATCH_VOLUME_HOLDS);
  });

  it("только брони: активные суммируются по обоим измерениям", () => {
    const h = computeBatchVolumeHolds({
      reservations: [
        { qtySlabs: 2, qtyAreaM2: 10, expiresAt: FUTURE },
        { qtySlabs: 3, qtyAreaM2: null, expiresAt: FUTURE },
      ],
      samples: [],
      now: NOW,
    });
    expect(h.reservationSlabs).toBe(5);
    expect(h.reservationAreaM2).toBe(10);
    expect(h.sampleSlabs).toBe(0);
    expect(h.totalSlabs).toBe(5);
    expect(h.totalAreaM2).toBe(10);
  });

  it("только образцы: держат объём как брони (без правила истечения)", () => {
    const h = computeBatchVolumeHolds({
      reservations: [],
      samples: [
        { qtySlabs: 1, qtyAreaM2: 3 },
        { qtySlabs: null, qtyAreaM2: 2.5 },
      ],
      now: NOW,
    });
    expect(h.sampleSlabs).toBe(1);
    expect(h.sampleAreaM2).toBe(5.5);
    expect(h.totalSlabs).toBe(1);
    expect(h.totalAreaM2).toBe(5.5);
  });

  it("смешанные: итог = брони + образцы", () => {
    const h = computeBatchVolumeHolds({
      reservations: [{ qtySlabs: 4, qtyAreaM2: 20, expiresAt: FUTURE }],
      samples: [{ qtySlabs: 1, qtyAreaM2: 3 }],
      now: NOW,
    });
    expect(h.totalSlabs).toBe(5);
    expect(h.totalAreaM2).toBe(23);
  });

  it("истёкшая бронь (expiresAt <= now) ИСКЛЮЧАЕТСЯ — как в issueSample/A2", () => {
    const h = computeBatchVolumeHolds({
      reservations: [
        { qtySlabs: 9, qtyAreaM2: 99, expiresAt: PAST },
        { qtySlabs: 9, qtyAreaM2: 99, expiresAt: NOW }, // ровно now — тоже свободна
        { qtySlabs: 2, qtyAreaM2: 10, expiresAt: FUTURE },
      ],
      samples: [],
      now: NOW,
    });
    expect(h.totalSlabs).toBe(2);
    expect(h.totalAreaM2).toBe(10);
  });

  it("null-количества считаются нулём (измерение не занято)", () => {
    const h = computeBatchVolumeHolds({
      reservations: [{ qtySlabs: null, qtyAreaM2: null, expiresAt: FUTURE }],
      samples: [{ qtySlabs: null, qtyAreaM2: null }],
      now: NOW,
    });
    expect(h).toEqual(EMPTY_BATCH_VOLUME_HOLDS);
  });
});

describe("findOwnActiveVolumeReservations — свои активные брони (W1-T1)", () => {
  const row = (over: Partial<{
    id: string;
    managerId: string;
    customerName: string;
    qtySlabs: number | null;
    qtyAreaM2: number | null;
    expiresAt: Date;
  }> = {}) => ({
    id: "r1",
    managerId: "mgr-a",
    customerName: "Иван",
    qtySlabs: 1,
    qtyAreaM2: null,
    expiresAt: FUTURE,
    ...over,
  });

  it("своя активная попадает; чужая — нет", () => {
    const rows = [
      row({ id: "own" }),
      row({ id: "other", managerId: "mgr-b" }),
    ];
    expect(
      findOwnActiveVolumeReservations(rows, "mgr-a", NOW).map((r) => r.id),
    ).toEqual(["own"]);
  });

  it("истёкшая своя бронь не предлагается к погашению", () => {
    const rows = [row({ id: "dead", expiresAt: PAST })];
    expect(findOwnActiveVolumeReservations(rows, "mgr-a", NOW)).toEqual([]);
  });
});

describe("formatHoldQty — компактный объём hold'а", () => {
  it("плиты / м² / оба / ноль", () => {
    expect(formatHoldQty(3, 0)).toBe("3 плит");
    expect(formatHoldQty(0, 12.5)).toBe("≈12,5 м²");
    expect(formatHoldQty(3, 12.5)).toBe("3 плит · ≈12,5 м²");
    expect(formatHoldQty(0, 0)).toBe("0");
  });
});
