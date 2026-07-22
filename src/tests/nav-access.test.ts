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

  it("Карта склада — OWNER/MANAGER/WAREHOUSE ko'radi, PARTNER yo'q (TZ §3)", () => {
    // Точные локации — canSeeExactRemainder (PARTNER'dan boshqa hammasi).
    expect(canAccessNav("/karta-sklada", caps("OWNER"))).toBe(true);
    expect(canAccessNav("/karta-sklada", caps("MANAGER"))).toBe(true);
    expect(canAccessNav("/karta-sklada", caps("WAREHOUSE"))).toBe(true);
    expect(canAccessNav("/karta-sklada", caps("PARTNER"))).toBe(false);
  });

  it("История — только OWNER (§3: «действия сотрудников»), остальные нет", () => {
    // Журнал действий — canSeeHistory: только Владелец.
    expect(canAccessNav("/istoriya", caps("OWNER"))).toBe(true);
    expect(canAccessNav("/istoriya", caps("MANAGER"))).toBe(false);
    expect(canAccessNav("/istoriya", caps("WAREHOUSE"))).toBe(false);
    expect(canAccessNav("/istoriya", caps("PARTNER"))).toBe(false);
  });

  it("Сотрудники (/accounts) — только OWNER (OWN-03), остальные нет", () => {
    // Управление аккаунтами — canManageAccounts: только Владелец.
    expect(canAccessNav("/accounts", caps("OWNER"))).toBe(true);
    expect(canAccessNav("/accounts", caps("MANAGER"))).toBe(false);
    expect(canAccessNav("/accounts", caps("WAREHOUSE"))).toBe(false);
    expect(canAccessNav("/accounts", caps("PARTNER"))).toBe(false);
  });

  it("Заявки (/zayavki) — OWNER/MANAGER ko'radi, WAREHOUSE/PARTNER yo'q (A1, §6.8)", () => {
    // Лиды партнёров — canSeeLeads: OWNER/MANAGER обрабатывают.
    expect(canAccessNav("/zayavki", caps("OWNER"))).toBe(true);
    expect(canAccessNav("/zayavki", caps("MANAGER"))).toBe(true);
    expect(canAccessNav("/zayavki", caps("WAREHOUSE"))).toBe(false);
    expect(canAccessNav("/zayavki", caps("PARTNER"))).toBe(false);
  });

  it("noma'lum yo'nalish — deny emas, ko'rsatiladi (nav kosmetik)", () => {
    expect(canAccessNav("/kakoy-to-put", caps("PARTNER"))).toBe(true);
  });
});
