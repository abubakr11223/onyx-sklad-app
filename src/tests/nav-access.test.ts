// R2 — nav ko'rinishi: SOF surface→huquq xaritasi testlari (DB YO'Q).
// Normativ manba: TZ §3. capabilitiesFor bilan birga ishlatiladi.
import { describe, expect, it } from "vitest";
import { capabilitiesFor, type Role } from "@/lib/permissions";
import { NAV_REQUIRED_CAPABILITY, canAccessNav } from "@/lib/nav-access";

const caps = (role: Role) =>
  capabilitiesFor(role, { canSeePurchasePrice: false });

describe("canAccessNav — rol bo'yicha nav ko'rinishi", () => {
  it("Поиск и Карта — весь персонал; партнёру — нет (ТЗ №20 L: только каталог)", () => {
    for (const role of ["OWNER", "MANAGER", "WAREHOUSE", "WAREHOUSE_LEAD"] as Role[]) {
      expect(canAccessNav("/poisk", caps(role))).toBe(true);
      expect(canAccessNav("/karta", caps(role))).toBe(true);
    }
    expect(canAccessNav("/poisk", caps("PARTNER"))).toBe(false);
    expect(canAccessNav("/karta", caps("PARTNER"))).toBe(false);
  });

  it("ТЗ №20 L — партнёр видит только «Каталог» и «Мои заявки»", () => {
    const p = caps("PARTNER");
    const visible = Object.keys(NAV_REQUIRED_CAPABILITY).filter((h) => canAccessNav(h, p));
    expect(visible.sort()).toEqual(["/katalog", "/moi-zayavki"]);
    expect(canAccessNav("/partnery", caps("MANAGER"))).toBe(true);
    expect(canAccessNav("/partnery", caps("WAREHOUSE"))).toBe(false);
    expect(canAccessNav("/moi-zayavki", caps("MANAGER"))).toBe(false);
  });

  it("WAREHOUSE — Приёмка/Разбить/Фото-vazifalar (+ doim ochiqlar); sotuv yashirin", () => {
    const w = caps("WAREHOUSE");
    expect(canAccessNav("/priemka", w)).toBe(true);
    expect(canAccessNav("/razbit", w)).toBe(true);
    expect(canAccessNav("/poisk", w)).toBe(true);
    // W6-B: canViewPhotoTasks — §3 «задачи на фото», §5.9 dual access
    expect(canAccessNav("/fotozapros", w)).toBe(true);
    expect(canAccessNav("/otgruzki", w)).toBe(true); // TZ15
    expect(canAccessNav("/bron", w)).toBe(false);
    expect(canAccessNav("/prodazha", w)).toBe(false);
  });

  it("PARTNER — Отгрузки yashirin (route gate: canSeeShipments=false)", () => {
    expect(canAccessNav("/otgruzki", caps("PARTNER"))).toBe(false);
    expect(caps("PARTNER").canSeeShipments).toBe(false);
  });

  it("Шоу-рум — OWNER/MANAGER/WAREHOUSE; PARTNER yo'q", () => {
    expect(canAccessNav("/shourum", caps("OWNER"))).toBe(true);
    expect(canAccessNav("/shourum", caps("MANAGER"))).toBe(true);
    expect(canAccessNav("/shourum", caps("WAREHOUSE"))).toBe(true);
    expect(canAccessNav("/shourum", caps("PARTNER"))).toBe(false);
  });

  it("MANAGER — /otgruzki ochiq (own scope); confirm yo'q", () => {
    const m = caps("MANAGER");
    expect(canAccessNav("/otgruzki", m)).toBe(true);
    expect(m.canSeeShipments).toBe(true);
    expect(m.canConfirmShipment).toBe(false);
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
      // «Мои заявки» — кабинет партнёра, владельцу не нужен (у него «Заявки»).
      if (href === "/moi-zayavki") continue;
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

  it("Должники (/dolzhniki) — только OWNER (TZ №9 §5), менеджер/склад/партнёр нет", () => {
    expect(canAccessNav("/dolzhniki", caps("OWNER"))).toBe(true);
    expect(canAccessNav("/dolzhniki", caps("MANAGER"))).toBe(false);
    expect(canAccessNav("/dolzhniki", caps("WAREHOUSE"))).toBe(false);
    expect(canAccessNav("/dolzhniki", caps("PARTNER"))).toBe(false);
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

describe("Клиенты / Объекты — canSeeClients (TZ №10+11 §7)", () => {
  it("OWNER/MANAGER → /klienty и /obekty открыты", () => {
    for (const role of ["OWNER", "MANAGER"] as Role[]) {
      expect(canAccessNav("/klienty", caps(role))).toBe(true);
      expect(canAccessNav("/obekty", caps(role))).toBe(true);
    }
  });
  it("WAREHOUSE/PARTNER → закрыты", () => {
    for (const role of ["WAREHOUSE", "PARTNER"] as Role[]) {
      expect(canAccessNav("/klienty", caps(role))).toBe(false);
      expect(canAccessNav("/obekty", caps(role))).toBe(false);
    }
  });
});

describe("Образцы /obraztsy — canSell (TZ №10)", () => {
  it("OWNER/MANAGER open", () => {
    for (const role of ["OWNER", "MANAGER"] as Role[]) {
      expect(canAccessNav("/obraztsy", caps(role))).toBe(true);
    }
  });
  it("WAREHOUSE/PARTNER closed", () => {
    for (const role of ["WAREHOUSE", "PARTNER"] as Role[]) {
      expect(canAccessNav("/obraztsy", caps(role))).toBe(false);
    }
  });
});

describe("Сводка /svodka — OWNER + MANAGER (TZ №10+11 §9, ТЗ №20 E)", () => {
  it("OWNER/MANAGER → open (менеджер видит только рейтинг своих клиентов)", () => {
    expect(canAccessNav("/svodka", caps("OWNER"))).toBe(true);
    expect(canAccessNav("/svodka", caps("MANAGER"))).toBe(true);
  });
  it("WAREHOUSE/PARTNER → closed", () => {
    for (const role of ["WAREHOUSE", "PARTNER"] as Role[]) {
      expect(canAccessNav("/svodka", caps(role))).toBe(false);
    }
  });

  it("ТЗ №20 I — «Каталог» всем, «Подборки» — OWNER/MANAGER", () => {
    for (const role of ["OWNER", "MANAGER", "WAREHOUSE", "WAREHOUSE_LEAD", "PARTNER"] as Role[]) {
      expect(canAccessNav("/katalog", caps(role))).toBe(true);
    }
    expect(canAccessNav("/podborki", caps("OWNER"))).toBe(true);
    expect(canAccessNav("/podborki", caps("MANAGER"))).toBe(true);
    expect(canAccessNav("/podborki", caps("WAREHOUSE"))).toBe(false);
    expect(canAccessNav("/podborki", caps("WAREHOUSE_LEAD"))).toBe(false);
    expect(canAccessNav("/podborki", caps("PARTNER"))).toBe(false);
  });
});

