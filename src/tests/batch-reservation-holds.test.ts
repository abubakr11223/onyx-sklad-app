// BUG-03 — /poisk erkin qoldig'i BATCH_VOLUME bronlarni minus qilmasdi
// («jami 10, bronda 2» bo'lsa ham «bo'sh 10»). reservationHoldsFromRows sof
// mantig'ini tekshiradi: faol volume-bron band qoldiqni kamaytiradi, muddati
// o'tgani (sweep hali yopmagan bo'lsa ham) KAMAYTIRMAYDI. DB YO'Q — getBatchReser-
// vationHolds SQL filtridan keyin aynan shu reducerni chaqiradi (par.: batch-
// remainders.test.ts uslubi; reservations.sumActiveVolumeHolds bilan bir mantiq).
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_HOLD,
  getBatchReservationHolds,
  reservationHoldsFromRows,
} from "@/lib/batch-remainders";
import type { PrismaClient } from "@prisma/client";

const now = new Date("2026-07-01T00:00:00Z");
const future = new Date("2026-08-01T00:00:00Z");
const past = new Date("2026-06-01T00:00:00Z");

describe("reservationHoldsFromRows — faol volume-bron band qoldig'i", () => {
  it("faol bron partiya bo'yicha band slab/m² yig'adi", () => {
    const holds = reservationHoldsFromRows(
      [{ batchId: "b1", qtySlabs: 2, qtyAreaM2: 11, expiresAt: future }],
      now,
    );
    expect(holds.get("b1")).toEqual({ reservedSlabs: 2, reservedAreaM2: 11 });
  });

  it("muddati o'tgan bron band qoldiqni KAMAYTIRMAYDI (sweep'gacha)", () => {
    const holds = reservationHoldsFromRows(
      [{ batchId: "b1", qtySlabs: 5, qtyAreaM2: 30, expiresAt: past }],
      now,
    );
    expect(holds.has("b1")).toBe(false);
  });

  it("expiresAt === now → o'tgan hisoblanadi (chiqarib tashlanadi)", () => {
    const holds = reservationHoldsFromRows(
      [{ batchId: "b1", qtySlabs: 1, qtyAreaM2: 1, expiresAt: now }],
      now,
    );
    expect(holds.has("b1")).toBe(false);
  });

  it("bir partiyada bir nechta faol bron yig'iladi", () => {
    const holds = reservationHoldsFromRows(
      [
        { batchId: "b1", qtySlabs: 2, qtyAreaM2: null, expiresAt: future },
        { batchId: "b1", qtySlabs: 3, qtyAreaM2: null, expiresAt: future },
      ],
      now,
    );
    expect(holds.get("b1")).toEqual({ reservedSlabs: 5, reservedAreaM2: 0 });
  });

  it("faol + o'tgan aralash: faqat faol qismi sanaladi", () => {
    const holds = reservationHoldsFromRows(
      [
        { batchId: "b1", qtySlabs: 2, qtyAreaM2: 10, expiresAt: future },
        { batchId: "b1", qtySlabs: 4, qtyAreaM2: 20, expiresAt: past },
      ],
      now,
    );
    expect(holds.get("b1")).toEqual({ reservedSlabs: 2, reservedAreaM2: 10 });
  });

  it("qtySlabs/qtyAreaM2 null → 0 sifatida qo'shiladi", () => {
    const holds = reservationHoldsFromRows(
      [{ batchId: "b1", qtySlabs: null, qtyAreaM2: 4.5, expiresAt: future }],
      now,
    );
    expect(holds.get("b1")).toEqual({ reservedSlabs: 0, reservedAreaM2: 4.5 });
  });

  it("har partiya alohida yig'iladi", () => {
    const holds = reservationHoldsFromRows(
      [
        { batchId: "b1", qtySlabs: 2, qtyAreaM2: null, expiresAt: future },
        { batchId: "b2", qtySlabs: 7, qtyAreaM2: null, expiresAt: future },
      ],
      now,
    );
    expect(holds.get("b1")?.reservedSlabs).toBe(2);
    expect(holds.get("b2")?.reservedSlabs).toBe(7);
  });

  it("batchId null qatorni chetlab o'tadi", () => {
    const holds = reservationHoldsFromRows(
      [{ batchId: null, qtySlabs: 9, qtyAreaM2: 9, expiresAt: future }],
      now,
    );
    expect(holds.size).toBe(0);
  });

  it("bo'sh kirish → bo'sh map", () => {
    expect(reservationHoldsFromRows([], now).size).toBe(0);
  });
});

// /poisk ko'rsatadigan erkin qoldiq mantig'i: erkin = max(0, jami − band).
// Aynan shu ayirish page.tsx da har vid bo'yicha bajariladi (bug bo'shlig'i).
describe("BUG-03 — poisk erkin qoldiq = max(0, jami − faol bron)", () => {
  const slabsTotal = 10;
  function displayedFree(
    rows: Parameters<typeof reservationHoldsFromRows>[0],
  ): number {
    const hold = reservationHoldsFromRows(rows, now).get("b1") ?? EMPTY_HOLD;
    return Math.max(0, slabsTotal - hold.reservedSlabs);
  }

  it("faol bron erkin qoldiqni kamaytiradi (10 − 2 = 8)", () => {
    expect(
      displayedFree([
        { batchId: "b1", qtySlabs: 2, qtyAreaM2: null, expiresAt: future },
      ]),
    ).toBe(8);
  });

  it("muddati o'tgan bron erkin qoldiqni kamaytirmaydi (10 − 0 = 10)", () => {
    expect(
      displayedFree([
        { batchId: "b1", qtySlabs: 2, qtyAreaM2: null, expiresAt: past },
      ]),
    ).toBe(10);
  });

  it("faol bron > jami bo'lsa ham manfiy emas (0 ga qisiladi)", () => {
    expect(
      displayedFree([
        { batchId: "b1", qtySlabs: 99, qtyAreaM2: null, expiresAt: future },
      ]),
    ).toBe(0);
  });

  it("EMPTY_HOLD → to'liq erkin (bron yo'q)", () => {
    expect(Math.max(0, slabsTotal - EMPTY_HOLD.reservedSlabs)).toBe(10);
  });
});

// DB qatlamidagi `where` filtri (status ACTIVE / targetType BATCH_VOLUME / expiresAt
// gt now / batchId in) — himoyalanmagan: kimdir `status:"ACTIVE"` ni olib tashlasa,
// EXPIRED/COMPLETED/CANCELLED hajm-bronlari (hali qtySlabs/qtyAreaM2 ko'targan)
// «в брони»ni shishirar va sof reducer testlari buni tutmasdi. Bu yerda db stub
// qilinadi (DB-siz): (a) `where` to'g'ri berilishini, (b) filtrga qaramay o'tib
// ketgan muddati o'tgan qatorni reducer'ning expiry qayta-tekshiruvi chiqarishini.
describe("getBatchReservationHolds — DB filtri (stub db, DB-siz)", () => {
  it("to'g'ri where bilan chaqiradi (ACTIVE + BATCH_VOLUME + expiresAt gt now + batchId in)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { reservation: { findMany } } as unknown as PrismaClient;

    await getBatchReservationHolds(db, ["b1", "b2"], now);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: "ACTIVE",
      targetType: "BATCH_VOLUME",
      batchId: { in: ["b1", "b2"] },
      expiresAt: { gt: now },
    });
  });

  it("filtrdan o'tib ketgan muddati o'tgan qatorni reducer chiqaradi (faqat faol sanaladi)", async () => {
    // Stub filtrsiz qatorlar qaytaradi (go'yo `status:"ACTIVE"` tushib qolgan) —
    // muddati o'tgani ham keladi, lekin sof reducer expiry qayta-tekshiruvi uni tashlaydi.
    const findMany = vi.fn().mockResolvedValue([
      { batchId: "b1", qtySlabs: 2, qtyAreaM2: 10, expiresAt: future },
      { batchId: "b1", qtySlabs: 5, qtyAreaM2: 30, expiresAt: past },
    ]);
    const db = { reservation: { findMany } } as unknown as PrismaClient;

    const holds = await getBatchReservationHolds(db, ["b1"], now);

    expect(holds.get("b1")).toEqual({ reservedSlabs: 2, reservedAreaM2: 10 });
  });

  it("batchIds bo'sh → DB'ga umuman tegmaydi", async () => {
    const findMany = vi.fn();
    const db = { reservation: { findMany } } as unknown as PrismaClient;

    const holds = await getBatchReservationHolds(db, [], now);

    expect(findMany).not.toHaveBeenCalled();
    expect(holds.size).toBe(0);
  });
});
