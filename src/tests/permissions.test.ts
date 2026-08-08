// R1 — Rol-tizimi: ruxsat-dvigateli testlari (DB YO'Q, sof funksiya).
// Normativ manba: TZ §3 «Роли и права». To'liq matritsa har 4 rol bo'yicha.
import { describe, expect, it } from "vitest";
import { capabilitiesFor, type Capabilities, type Role } from "@/lib/permissions";

// Kutilgan matritsa (TZ §3). purchasePrice ustuni opts'ga bog'liq — pastda
// alohida tekshiriladi; bu yerda "canSee" default opts=true holatini beramiz.
const EXPECTED: Record<Role, Capabilities> = {
  OWNER: {
    canSeePrices: true,
    canSeePurchasePrice: true,
    canSell: true,
    canReserve: true,
    canRequestPhoto: true,
    canViewPhotoTasks: true,
    canManageWarehouse: true,
    canSeeExactRemainder: true,
    canSeeAllReservations: true,
    requestsRouteToManager: false,
    canSeeHistory: true,
    canManageAccounts: true,
    canSeeLeads: true,
    canSeeDebts: true, // TZ №9 — Должники: только OWNER
    canSeeClients: true, // TZ №10+11
    canSeeAllClients: true,
    canSeeShipments: true,
    canConfirmShipment: true,
  },
  MANAGER: {
    canSeePrices: true,
    canSeePurchasePrice: true, // opts=true holati; opts=false alohida testlanadi
    canSell: true,
    canReserve: true,
    canRequestPhoto: true,
    canViewPhotoTasks: true,
    canManageWarehouse: false,
    canSeeExactRemainder: true,
    canSeeAllReservations: false,
    requestsRouteToManager: false,
    canSeeHistory: false,
    canManageAccounts: false,
    canSeeLeads: true,
    canSeeDebts: false,
    canSeeClients: true, // TZ №10+11 — свои
    canSeeAllClients: false,
    canSeeShipments: true,
    canConfirmShipment: false,
  },
  WAREHOUSE: {
    canSeePrices: false,
    canSeePurchasePrice: false,
    canSell: false,
    canReserve: false,
    canRequestPhoto: false,
    canViewPhotoTasks: true, // §3/§7/§5.9 — vazifalar ko'rinadi; CREATE yo'q
    canManageWarehouse: true,
    canSeeExactRemainder: true,
    canSeeAllReservations: false,
    requestsRouteToManager: false,
    canSeeHistory: false,
    canManageAccounts: false,
    canSeeLeads: false,
    canSeeDebts: false,
    canSeeClients: false,
    canSeeAllClients: false,
    canSeeShipments: true,
    canConfirmShipment: true,
  },
  PARTNER: {
    canSeePrices: false,
    canSeePurchasePrice: false,
    canSell: false,
    canReserve: false,
    canRequestPhoto: false,
    canViewPhotoTasks: false,
    canManageWarehouse: false,
    canSeeExactRemainder: false,
    canSeeAllReservations: false,
    requestsRouteToManager: true,
    canSeeHistory: false,
    canManageAccounts: false,
    canSeeLeads: false,
    canSeeDebts: false,
    canSeeClients: false,
    canSeeAllClients: false,
    canSeeShipments: false,
    canConfirmShipment: false,
  },
};

const ROLES: Role[] = ["OWNER", "MANAGER", "WAREHOUSE", "PARTNER"];

describe("capabilitiesFor — to'liq matritsa (TZ §3)", () => {
  for (const role of ROLES) {
    it(`${role}: har bir huquq maydoni kutilgan qiymatda (opts=true)`, () => {
      const caps = capabilitiesFor(role, { canSeePurchasePrice: true });
      expect(caps).toEqual(EXPECTED[role]);
    });
  }
});

describe("canSeePurchasePrice — закупка/маржа qoidalari (TZ §3)", () => {
  it("OWNER — DOIM true, opts=false bo'lsa ham", () => {
    expect(
      capabilitiesFor("OWNER", { canSeePurchasePrice: false }).canSeePurchasePrice,
    ).toBe(true);
    expect(
      capabilitiesFor("OWNER", { canSeePurchasePrice: true }).canSeePurchasePrice,
    ).toBe(true);
  });

  it("MANAGER — aynan opts.canSeePurchasePrice (ikkala holat)", () => {
    expect(
      capabilitiesFor("MANAGER", { canSeePurchasePrice: true }).canSeePurchasePrice,
    ).toBe(true);
    expect(
      capabilitiesFor("MANAGER", { canSeePurchasePrice: false }).canSeePurchasePrice,
    ).toBe(false);
  });

  it("WAREHOUSE — DOIM false, opts e'tiborga olinmaydi", () => {
    expect(
      capabilitiesFor("WAREHOUSE", { canSeePurchasePrice: true }).canSeePurchasePrice,
    ).toBe(false);
    expect(
      capabilitiesFor("WAREHOUSE", { canSeePurchasePrice: false }).canSeePurchasePrice,
    ).toBe(false);
  });

  it("PARTNER — DOIM false, opts e'tiborga olinmaydi", () => {
    expect(
      capabilitiesFor("PARTNER", { canSeePurchasePrice: true }).canSeePurchasePrice,
    ).toBe(false);
    expect(
      capabilitiesFor("PARTNER", { canSeePurchasePrice: false }).canSeePurchasePrice,
    ).toBe(false);
  });
});

describe("requestsRouteToManager — faqat PARTNER oqimi (TZ §3)", () => {
  it("PARTNER — true", () => {
    expect(
      capabilitiesFor("PARTNER", { canSeePurchasePrice: false }).requestsRouteToManager,
    ).toBe(true);
  });
  it("OWNER/MANAGER/WAREHOUSE — false", () => {
    for (const role of ["OWNER", "MANAGER", "WAREHOUSE"] as Role[]) {
      expect(
        capabilitiesFor(role, { canSeePurchasePrice: false }).requestsRouteToManager,
      ).toBe(false);
    }
  });
});

describe("WAREHOUSE — ombor huquqi bor, sotuv/narx yo'q (TZ §3)", () => {
  const caps = capabilitiesFor("WAREHOUSE", { canSeePurchasePrice: true });
  it("canManageWarehouse — true", () => {
    expect(caps.canManageWarehouse).toBe(true);
  });
  it("canSell — false", () => {
    expect(caps.canSell).toBe(false);
  });
  it("canSeePrices — false", () => {
    expect(caps.canSeePrices).toBe(false);
  });
});

describe("Union'dan tashqari rol — deny-by-default (xavfsiz default)", () => {
  it("noma'lum/kelajakdagi rol → BARCHA huquqlar false", () => {
    const caps = capabilitiesFor("SUPERADMIN" as unknown as Role, {
      canSeePurchasePrice: true,
    });
    expect(caps.canSell).toBe(false);
    expect(caps.canSeePrices).toBe(false);
    expect(caps.canManageWarehouse).toBe(false);
    expect(caps.canSeePurchasePrice).toBe(false);
    // to'liqligi uchun — qolgan maydonlar ham false
    expect(caps.canReserve).toBe(false);
    expect(caps.canRequestPhoto).toBe(false);
    expect(caps.canViewPhotoTasks).toBe(false);
    expect(caps.canSeeExactRemainder).toBe(false);
    expect(caps.canSeeAllReservations).toBe(false);
    expect(caps.requestsRouteToManager).toBe(false);
    expect(caps.canSeeHistory).toBe(false);
    expect(caps.canManageAccounts).toBe(false);
    expect(caps.canSeeLeads).toBe(false);
    expect(caps.canSeeDebts).toBe(false);
    expect(caps.canSeeClients).toBe(false);
    expect(caps.canSeeAllClients).toBe(false);
  });
});

describe("canViewPhotoTasks vs canRequestPhoto (W6-B, TZ §3/§5.3/§5.9)", () => {
  it("WAREHOUSE: vazifalarni ko'radi, lekin so'rov YARATMAYDI/yopmaydi", () => {
    const w = capabilitiesFor("WAREHOUSE", { canSeePurchasePrice: false });
    expect(w.canViewPhotoTasks).toBe(true);
    expect(w.canRequestPhoto).toBe(false);
  });

  it("OWNER/MANAGER: ikkalasi ham true (to'liq fotozapros boshqaruvi)", () => {
    for (const role of ["OWNER", "MANAGER"] as Role[]) {
      const c = capabilitiesFor(role, { canSeePurchasePrice: false });
      expect(c.canViewPhotoTasks).toBe(true);
      expect(c.canRequestPhoto).toBe(true);
    }
  });

  it("PARTNER: ikkalasi false", () => {
    const p = capabilitiesFor("PARTNER", { canSeePurchasePrice: false });
    expect(p.canViewPhotoTasks).toBe(false);
    expect(p.canRequestPhoto).toBe(false);
  });
});

describe("canSeeLeads — заявки партнёров (A1, TZ §6.8)", () => {
  it("OWNER/MANAGER → true (обрабатывают лиды)", () => {
    for (const role of ["OWNER", "MANAGER"] as Role[]) {
      expect(
        capabilitiesFor(role, { canSeePurchasePrice: false }).canSeeLeads,
      ).toBe(true);
    }
  });
  it("WAREHOUSE/PARTNER → false (склад не продаёт; партнёр лишь создаёт)", () => {
    for (const role of ["WAREHOUSE", "PARTNER"] as Role[]) {
      expect(
        capabilitiesFor(role, { canSeePurchasePrice: false }).canSeeLeads,
      ).toBe(false);
    }
  });
});

describe("canManageAccounts — управление аккаунтами (OWN-03): только OWNER", () => {
  it("OWNER → true", () => {
    expect(
      capabilitiesFor("OWNER", { canSeePurchasePrice: false }).canManageAccounts,
    ).toBe(true);
  });
  it("MANAGER/WAREHOUSE/PARTNER → false (повышение прав закрыто)", () => {
    for (const role of ["MANAGER", "WAREHOUSE", "PARTNER"] as Role[]) {
      expect(
        capabilitiesFor(role, { canSeePurchasePrice: true }).canManageAccounts,
      ).toBe(false);
    }
  });
});

describe("canSeeHistory — журнал действий (TZ §8/§3)", () => {
  it("OWNER — true (видит действия сотрудников, §3)", () => {
    for (const role of ["OWNER"] as Role[]) {
      expect(
        capabilitiesFor(role, { canSeePurchasePrice: false }).canSeeHistory,
      ).toBe(true);
    }
  });
  it("MANAGER/WAREHOUSE/PARTNER — false (журнал всех действий только Владельцу)", () => {
    for (const role of ["MANAGER", "WAREHOUSE", "PARTNER"] as Role[]) {
      expect(
        capabilitiesFor(role, { canSeePurchasePrice: false }).canSeeHistory,
      ).toBe(false);
    }
  });
});

describe("OWNER va MANAGER — narx/sotuv/бронь-vidimost farqlari (TZ §3)", () => {
  const owner = capabilitiesFor("OWNER", { canSeePurchasePrice: false });
  const manager = capabilitiesFor("MANAGER", { canSeePurchasePrice: true });

  it("OWNER: canSell/canSeePrices/canSeeAllReservations — hammasi true", () => {
    expect(owner.canSell).toBe(true);
    expect(owner.canSeePrices).toBe(true);
    expect(owner.canSeeAllReservations).toBe(true);
  });

  it("MANAGER: canSeeAllReservations — false (faqat o'ziniki)", () => {
    expect(manager.canSeeAllReservations).toBe(false);
  });

  it("MANAGER: canManageWarehouse — false", () => {
    expect(manager.canManageWarehouse).toBe(false);
  });
});

describe("canSeeClients / canSeeAllClients — справочники (TZ №10+11 §7/§12)", () => {
  it("OWNER: canSeeClients + canSeeAllClients — true (все клиенты/объекты)", () => {
    const c = capabilitiesFor("OWNER", { canSeePurchasePrice: false });
    expect(c.canSeeClients).toBe(true);
    expect(c.canSeeAllClients).toBe(true);
  });

  it("MANAGER: canSeeClients true, canSeeAllClients false (только свои)", () => {
    const c = capabilitiesFor("MANAGER", { canSeePurchasePrice: false });
    expect(c.canSeeClients).toBe(true);
    expect(c.canSeeAllClients).toBe(false);
  });

  it("WAREHOUSE/PARTNER: оба false (не работают со справочниками)", () => {
    for (const role of ["WAREHOUSE", "PARTNER"] as Role[]) {
      const c = capabilitiesFor(role, { canSeePurchasePrice: false });
      expect(c.canSeeClients).toBe(false);
      expect(c.canSeeAllClients).toBe(false);
    }
  });
});

