// R2 — nav ko'rinishi: SOF surface→huquq xaritasi testlari (DB YO'Q).
// Normativ manba: TZ §3. capabilitiesFor bilan birga ishlatiladi.
import { describe, expect, it } from "vitest";
import { capabilitiesFor, type Role } from "@/lib/permissions";
import { NAV_REQUIRED_CAPABILITY, canAccessNav } from "@/lib/nav-access";

const caps = (role: Role) =>
  capabilitiesFor(role, { canSeePurchasePrice: false });

describe("canAccessNav — rol bo'yicha nav ko'rinishi", () => {
  it("Поиск и Карта — доим ochiq (barcha rollarga)", () => {
    for (const role of ["OWNER", "MANAGER", "WAREHOUSE", "PARTNER"] as Role[]) {
      expect(canAccessNav("/poisk", caps(role))).toBe(true);
      expect(canAccessNav("/karta", caps(role))).toBe(true);
    }
  });

  it("WAREHOUSE — faqat Приёмка/Разбить (+ доим ochiqlar), qolgani yashirin", () => {
    const w = caps("WAREHOUSE");
    expect(canAccessNav("/priemka", w)).toBe(true);
    expect(canAccessNav("/razbit", w)).toBe(true);
    expect(canAccessNav("/poisk", w)).toBe(true);
    expect(canAccessNav("/bron", w)).toBe(false);
    expect(canAccessNav("/prodazha", w)).toBe(false);
    expect(canAccessNav("/fotozapros", w)).toBe(false);
  });

  it("MANAGER — sotuv/bron/foto ochiq, ammo Приёмка/Разбить yopiq (TZ §3)", () => {
    const m = caps("MANAGER");
    expect(canAccessNav("/prodazha", m)).toBe(true);
    expect(canAccessNav("/bron", m)).toBe(true);
    expect(canAccessNav("/fotozapros", m)).toBe(true);
    expect(canAccessNav("/priemka", m)).toBe(false);
    expect(canAccessNav("/razbit", m)).toBe(false);
  });

  it("OWNER — hamma yo'nalish ochiq (hech narsa yo'qotmaydi)", () => {
    const o = caps("OWNER");
    for (const href of Object.keys(NAV_REQUIRED_CAPABILITY)) {
      expect(canAccessNav(href, o)).toBe(true);
    }
  });

  it("noma'lum yo'nalish — deny emas, ko'rsatiladi (nav kosmetik)", () => {
    expect(canAccessNav("/kakoy-to-put", caps("PARTNER"))).toBe(true);
  });
});
