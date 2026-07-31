// S2-A — bron sof helperlari testlari (DB YO'Q).
// Normativ manba: TZ §4.4, data-model.md §1.6/§2/§3, ADR-003.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESERVATION_DAYS,
  MAX_RESERVATION_DAYS,
  ReservationError,
  canManageReservation,
  canReserveVolume,
  computeExpiresAt,
  parseReservationDaysConfig,
  reservationListScope,
  resolveReservationDays,
  sumActiveVolumeHolds,
} from "@/lib/reservations";

describe("parseReservationDaysConfig — ADR-003", () => {
  it("to'g'ri qiymat parse qilinadi", () => {
    expect(parseReservationDaysConfig("3")).toBe(3);
    expect(parseReservationDaysConfig(" 5 ")).toBe(5);
    expect(parseReservationDaysConfig("1")).toBe(1);
  });

  it("yo'q/buzuq qiymat → default 3", () => {
    expect(parseReservationDaysConfig(null)).toBe(DEFAULT_RESERVATION_DAYS);
    expect(parseReservationDaysConfig(undefined)).toBe(DEFAULT_RESERVATION_DAYS);
    expect(parseReservationDaysConfig("")).toBe(DEFAULT_RESERVATION_DAYS);
    expect(parseReservationDaysConfig("abc")).toBe(DEFAULT_RESERVATION_DAYS);
    expect(parseReservationDaysConfig("0")).toBe(DEFAULT_RESERVATION_DAYS);
    expect(parseReservationDaysConfig("-2")).toBe(DEFAULT_RESERVATION_DAYS);
    expect(parseReservationDaysConfig(String(MAX_RESERVATION_DAYS + 1))).toBe(
      DEFAULT_RESERVATION_DAYS,
    );
  });
});

describe("resolveReservationDays", () => {
  it("foydalanuvchi qiymati ustuvor", () => {
    expect(resolveReservationDays(5, "3")).toBe(5);
    expect(resolveReservationDays(1, null)).toBe(1);
  });

  it("kiritilmagan → config, config yo'q → 3", () => {
    expect(resolveReservationDays(null, "7")).toBe(7);
    expect(resolveReservationDays(undefined, null)).toBe(3);
  });

  it("chegaradan tashqari foydalanuvchi qiymati → VALIDATION xato", () => {
    expect(() => resolveReservationDays(0, "3")).toThrow(ReservationError);
    expect(() => resolveReservationDays(-1, "3")).toThrow(ReservationError);
    expect(() => resolveReservationDays(2.5, "3")).toThrow(ReservationError);
    expect(() =>
      resolveReservationDays(MAX_RESERVATION_DAYS + 1, "3"),
    ).toThrow(ReservationError);
  });
});

describe("computeExpiresAt — expiresAt = now + days", () => {
  it("kunlar millisekundlarga to'g'ri qo'shiladi", () => {
    const now = new Date("2026-07-03T10:00:00.000Z");
    expect(computeExpiresAt(now, 3).toISOString()).toBe(
      "2026-07-06T10:00:00.000Z",
    );
    expect(computeExpiresAt(now, 1).toISOString()).toBe(
      "2026-07-04T10:00:00.000Z",
    );
  });
});

describe("canReserveVolume — §1.6 BATCH_VOLUME invarianti", () => {
  const avail = {
    slabsFree: 10,
    areaFreeM2: 50,
    reservedSlabs: 3,
    reservedAreaM2: 15,
  };

  it("erkin − band ichida → ok", () => {
    expect(canReserveVolume(avail, 7, null)).toEqual({ ok: true });
    expect(canReserveVolume(avail, null, 35)).toEqual({ ok: true });
    expect(canReserveVolume(avail, 7, 35)).toEqual({ ok: true });
  });

  it("plita soni erkin − band dan oshsa → rad", () => {
    const r = canReserveVolume(avail, 8, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("плит");
  });

  it("maydon erkin − band dan oshsa → rad", () => {
    const r = canReserveVolume(avail, null, 35.1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("площади");
  });

  it("bitta o'lchov oshsa ham rad (ikkalasi ham chegarada bo'lishi shart)", () => {
    expect(canReserveVolume(avail, 7, 40).ok).toBe(false);
    expect(canReserveVolume(avail, 20, 10).ok).toBe(false);
  });

  it("miqdor umuman ko'rsatilmagan → rad", () => {
    expect(canReserveVolume(avail, null, null).ok).toBe(false);
  });

  it("nol/manfiy/kasr plita, nol/manfiy maydon → rad", () => {
    expect(canReserveVolume(avail, 0, null).ok).toBe(false);
    expect(canReserveVolume(avail, -1, null).ok).toBe(false);
    expect(canReserveVolume(avail, 1.5, null).ok).toBe(false);
    expect(canReserveVolume(avail, null, 0).ok).toBe(false);
    expect(canReserveVolume(avail, null, -3).ok).toBe(false);
  });

  it("slabsFree = null → dona-nazorat o'chgan (§3), faqat maydon tekshiriladi", () => {
    const a = { ...avail, slabsFree: null };
    expect(canReserveVolume(a, 1000, null)).toEqual({ ok: true });
    expect(canReserveVolume(a, 1000, 36).ok).toBe(false);
  });

  it("areaFreeM2 = null → m²-nazorat o'chgan", () => {
    const a = { ...avail, areaFreeM2: null };
    expect(canReserveVolume(a, null, 99999)).toEqual({ ok: true });
    expect(canReserveVolume(a, 8, 99999).ok).toBe(false);
  });

  it("band > erkin bo'lib qolgan partiyada 1 dona ham rad", () => {
    const a = { slabsFree: 2, areaFreeM2: 10, reservedSlabs: 2, reservedAreaM2: 10 };
    expect(canReserveVolume(a, 1, null).ok).toBe(false);
    expect(canReserveVolume(a, null, 0.5).ok).toBe(false);
  });

  it("A1-b: miqdor tur chegarasidan oshsa → rad (Int4/Decimal overflow oldi)", () => {
    // slabsFree/areaFreeM2 = null → yetarlilik tekshiruvi o'chgan, lekin kap ishlaydi.
    const a = { slabsFree: null, areaFreeM2: null, reservedSlabs: 0, reservedAreaM2: 0 };
    expect(canReserveVolume(a, 1_000_001, null).ok).toBe(false);
    expect(canReserveVolume(a, null, 1_000_000_000).ok).toBe(false);
    // Chegaraning o'zi — o'tadi (yetarlilik nazorati o'chgani uchun).
    expect(canReserveVolume(a, 1_000_000, null)).toEqual({ ok: true });
    expect(canReserveVolume(a, null, 999_999_999.999)).toEqual({ ok: true });
  });
});

describe("sumActiveVolumeHolds — muddati o'tgan bron qoldiqni kesmaydi (A2)", () => {
  const NOW = new Date("2026-07-16T12:00:00.000Z");
  const future = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  const past = new Date(NOW.getTime() - 60 * 1000);

  it("faol (muddati o'tmagan) bronlar yig'iladi", () => {
    const holds = [
      { qtySlabs: 3, qtyAreaM2: 15, expiresAt: future },
      { qtySlabs: 2, qtyAreaM2: 10, expiresAt: future },
    ];
    expect(sumActiveVolumeHolds(holds, NOW)).toEqual({
      reservedSlabs: 5,
      reservedAreaM2: 25,
    });
  });

  it("muddati o'tgan bron yig'indiga KIRMAYDI (erkin qoldiqni kamaytirmaydi)", () => {
    const holds = [
      { qtySlabs: 3, qtyAreaM2: 15, expiresAt: future },
      { qtySlabs: 8, qtyAreaM2: 80, expiresAt: past }, // muddati o'tgan
    ];
    expect(sumActiveVolumeHolds(holds, NOW)).toEqual({
      reservedSlabs: 3,
      reservedAreaM2: 15,
    });
  });

  it("null miqdorlar 0 sifatida", () => {
    const holds = [
      { qtySlabs: null, qtyAreaM2: 12, expiresAt: future },
      { qtySlabs: 4, qtyAreaM2: null, expiresAt: future },
    ];
    expect(sumActiveVolumeHolds(holds, NOW)).toEqual({
      reservedSlabs: 4,
      reservedAreaM2: 12,
    });
  });
});

describe("canManageReservation — §2 o'tish №4/№5 (egasi yoki OWNER)", () => {
  const reservation = { managerId: "m1" };

  it("bron egasi — mumkin", () => {
    expect(canManageReservation({ id: "m1", role: "MANAGER" }, reservation)).toBe(
      true,
    );
  });

  it("OWNER — har doim mumkin", () => {
    expect(canManageReservation({ id: "boss", role: "OWNER" }, reservation)).toBe(
      true,
    );
  });

  it("boshqa menejer / sklad / partner — mumkin emas", () => {
    expect(
      canManageReservation({ id: "m2", role: "MANAGER" }, reservation),
    ).toBe(false);
    expect(
      canManageReservation({ id: "w1", role: "WAREHOUSE" }, reservation),
    ).toBe(false);
    expect(
      canManageReservation({ id: "p1", role: "PARTNER" }, reservation),
    ).toBe(false);
  });
});

describe("reservationListScope — /bron ro'yxat maxfiyligi (W5-B, TZ §4.4)", () => {
  // Home KPI (page.tsx:59-63) va /bron findMany bir xil: OWNER hammasi,
  // MANAGER faqat o'z managerId — boshqa menejerning customerName sizdirilmasin.

  it("canSeeAllReservations → bo'sh scope (filtr yo'q = barcha qatorlar)", () => {
    expect(
      reservationListScope({
        canSeeAllReservations: true,
        actorId: "anyone",
      }),
    ).toEqual({});
    // OWNER actorId null bo'lsa ham «hammasi» — capability ustun.
    expect(
      reservationListScope({
        canSeeAllReservations: true,
        actorId: null,
      }),
    ).toEqual({});
  });

  it("MANAGER (canSeeAll=false) → faqat o'z managerId", () => {
    expect(
      reservationListScope({
        canSeeAllReservations: false,
        actorId: "mgr-42",
      }),
    ).toEqual({ managerId: "mgr-42" });
  });

  it("canSeeAll=false va actor yo'q → hech narsa (boshqa odamlarning ro'yxati emas)", () => {
    const scope = reservationListScope({
      canSeeAllReservations: false,
      actorId: null,
    });
    expect(scope).toEqual({ managerId: "__no_actor__" });
    // «filtr yo'q» bo'lmasligi shart — aks holda barcha bronlar sizadi.
    expect(scope).not.toEqual({});
  });
});
