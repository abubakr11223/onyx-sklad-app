// W2-T7 — «Свободно под бронь» на /bron: подсказка считает ТУ ЖЕ формулу,
// что охрана брони (canReserveVolume + computeBatchVolumeHolds): образцы
// режут остаток, истёкшие брони — нет; показ клампится в 0.
import { describe, expect, it } from "vitest";
import { computeFreeHint } from "@/app/bron/free-hint";
import { canReserveVolume } from "@/lib/reservations";
import { computeBatchVolumeHolds } from "@/lib/volume-holds";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-28T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 24 * HOUR);
const PAST = new Date(NOW.getTime() - HOUR);

describe("computeFreeHint — подсказка = охрана (W2-T7)", () => {
  // Fixture: 10 плит / 50 м² свободного остатка; hold'ы — чужая активная
  // бронь (3 / 12), истёкшая бронь (9 / 99, НЕ должна резать) и активный
  // BATCH_VOLUME-образец (1 / 3).
  const fixture = {
    slabsFree: 10,
    areaFreeM2: 50,
    reservations: [
      { qtySlabs: 3, qtyAreaM2: 12, expiresAt: FUTURE }, // чужая, активная
      { qtySlabs: 9, qtyAreaM2: 99, expiresAt: PAST }, // истёкшая — свободна
    ],
    samples: [{ qtySlabs: 1, qtyAreaM2: 3 }],
    now: NOW,
  };

  it("образцы и истёкшие учитываются как у охраны: 10−3−1 / 50−12−3", () => {
    const hint = computeFreeHint(fixture);
    expect(hint.freeSlabs).toBe(6);
    expect(hint.freeAreaM2).toBe(35);
  });

  it("значение подсказки — ровно cap охраны: hint проходит, hint+1 — отказ", () => {
    const hint = computeFreeHint(fixture);
    const holds = computeBatchVolumeHolds({
      reservations: fixture.reservations,
      samples: fixture.samples,
      now: NOW,
    });
    const avail = {
      slabsFree: fixture.slabsFree,
      areaFreeM2: fixture.areaFreeM2,
      reservedSlabs: holds.totalSlabs,
      reservedAreaM2: holds.totalAreaM2,
    };
    // Ровно столько, сколько обещает подсказка — охрана пропускает.
    expect(
      canReserveVolume(avail, hint.freeSlabs, hint.freeAreaM2).ok,
    ).toBe(true);
    // На единицу больше по любому измерению — охрана отказывает.
    expect(canReserveVolume(avail, hint.freeSlabs! + 1, null).ok).toBe(false);
    expect(canReserveVolume(avail, null, hint.freeAreaM2! + 0.1).ok).toBe(
      false,
    );
  });

  it("кламп: hold'ы больше остатка → показ 0, не отрицательное", () => {
    const hint = computeFreeHint({
      slabsFree: 2,
      areaFreeM2: 5,
      reservations: [{ qtySlabs: 3, qtyAreaM2: 8, expiresAt: FUTURE }],
      samples: [{ qtySlabs: 1, qtyAreaM2: 1 }],
      now: NOW,
    });
    expect(hint.freeSlabs).toBe(0);
    expect(hint.freeAreaM2).toBe(0);
  });

  it("null-измерение (§3, не отслеживается) остаётся null", () => {
    const hint = computeFreeHint({
      slabsFree: null,
      areaFreeM2: 50,
      reservations: [],
      samples: [],
      now: NOW,
    });
    expect(hint.freeSlabs).toBeNull();
    expect(hint.freeAreaM2).toBe(50);
  });
});
