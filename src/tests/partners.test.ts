// ТЗ №20 L — кабинет партнёра: заявка на объём, уведомления, заявка → продажа,
// «Партнёры» в «Сводке». БД — mock.
import { describe, expect, it, vi } from "vitest";
import {
  closeLeadWithSale,
  formatPartnerLeadNotification,
  isPartnerType,
  loadLeadSalePrefill,
  loadPartnerSummary,
  notifyPartnerLeadSafe,
  parseVolumeRequest,
  partnerLeadRecipients,
  PARTNER_TYPE_RU,
  tashkentToday,
  volumeText,
} from "@/lib/partners";
import { roleLabel } from "@/lib/role-labels";

const NOW = new Date("2026-11-09T07:00:00Z"); // 12:00 Ташкент

describe("§13.1 роль и тип", () => {
  it("роль называется «Партнёр», три типа", () => {
    expect(roleLabel("PARTNER")).toBe("Партнёр");
    expect(PARTNER_TYPE_RU).toEqual({ DESIGNER: "Дизайнер", FOREMAN: "Прораб", CONTRACTOR: "Подрядчик" });
    expect(isPartnerType("FOREMAN")).toBe(true);
    expect(isPartnerType("OWNER")).toBe(false);
  });
});

describe("§13.2 «Заявка на объём»", () => {
  it("объём обязателен: плиты или м²", () => {
    expect(parseVolumeRequest({}, NOW)).toEqual({ ok: false, error: "volume" });
    expect(parseVolumeRequest({ requestedSlabs: "10" }, NOW).ok).toBe(true);
    expect(parseVolumeRequest({ requestedAreaM2: "12,5" }, NOW).ok).toBe(true);
  });
  it("неверные числа — ошибка поля", () => {
    expect(parseVolumeRequest({ requestedSlabs: "2.5" }, NOW)).toEqual({ ok: false, error: "slabs" });
    expect(parseVolumeRequest({ requestedAreaM2: "-1" }, NOW)).toEqual({ ok: false, error: "area" });
  });
  it("объект, срок, комментарий", () => {
    const r = parseVolumeRequest(
      { requestedSlabs: "10", siteText: "  ЖК «Олмазор», блок 3 ", dueDate: "2026-12-01", note: "кухни" },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.siteText).toBe("ЖК «Олмазор», блок 3");
    expect(r.value.dueDate?.toISOString()).toBe("2026-12-01T07:00:00.000Z");
    expect(r.value.note).toBe("кухни");
  });
  it("срок в прошлом или кривой — ошибка; сегодня — можно", () => {
    expect(tashkentToday(NOW)).toBe("2026-11-09");
    expect(parseVolumeRequest({ requestedSlabs: "1", dueDate: "2026-11-08" }, NOW)).toEqual({ ok: false, error: "due" });
    expect(parseVolumeRequest({ requestedSlabs: "1", dueDate: "01.12.2026" }, NOW)).toEqual({ ok: false, error: "due" });
    expect(parseVolumeRequest({ requestedSlabs: "1", dueDate: "2026-11-09" }, NOW).ok).toBe(true);
  });
  it("слишком длинные объект и комментарий", () => {
    expect(parseVolumeRequest({ requestedSlabs: "1", siteText: "x".repeat(201) }, NOW)).toEqual({ ok: false, error: "site" });
    expect(parseVolumeRequest({ requestedSlabs: "1", note: "x".repeat(1001) }, NOW)).toEqual({ ok: false, error: "note" });
  });
  it("объём словами", () => {
    expect(volumeText(10, 25.5)).toBe("10 плит · 25,5 м²");
    expect(volumeText(null, null)).toBe("объём не указан");
  });
});

describe("Telegram: текст и получатели", () => {
  const base = {
    partnerName: "Азиз",
    partnerType: "FOREMAN" as const,
    stoneName: "Травертин Классик",
    stoneCode: "ONX-7K3QD",
    requestedSlabs: 10,
    requestedAreaM2: null,
    siteText: "ЖК Олмазор",
    dueDate: new Date("2026-12-01T07:00:00Z"),
    note: null,
    contact: null,
  };
  it("заявка: камень, объём, партнёр с типом, объект, срок", () => {
    const t = formatPartnerLeadNotification({ ...base, kind: "REQUEST" });
    expect(t).toContain("Заявка партнёра: Травертин Классик ONX-7K3QD, 10 плит");
    expect(t).toContain("Партнёр: Азиз (прораб)");
    expect(t).toContain("Объект: ЖК Олмазор");
    expect(t).toContain("Срок: 01.12.2026");
  });
  it("интересы — одной строкой", () => {
    expect(formatPartnerLeadNotification({ ...base, kind: "VIEW" })).toBe(
      "Интерес партнёра: Азиз (прораб) смотрит Травертин Классик ONX-7K3QD",
    );
    expect(formatPartnerLeadNotification({ ...base, kind: "TEXTURE_DOWNLOAD" })).toContain("скачал текстуру");
  });

  it("закреплённый менеджер с Telegram — только он", async () => {
    const db = {
      user: {
        findUnique: vi.fn(async () => ({
          partnerManager: { telegramId: "555", isActive: true, role: "MANAGER" },
        })),
        findMany: vi.fn(async () => [{ telegramId: "1" }, { telegramId: "2" }]),
      },
    };
    expect(await partnerLeadRecipients(db as never, "p1")).toEqual(["555"]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it("менеджер не задан / отключён / без Telegram — все менеджеры и владелец", async () => {
    for (const m of [null, { telegramId: "555", isActive: false, role: "MANAGER" }, { telegramId: null, isActive: true, role: "MANAGER" }]) {
      const db = {
        user: {
          findUnique: vi.fn(async () => ({ partnerManager: m })),
          findMany: vi.fn(async () => [{ telegramId: "1" }, { telegramId: "2" }]),
        },
      };
      expect(await partnerLeadRecipients(db as never, "p1")).toEqual(["1", "2"]);
    }
  });

  it("заявка уходит с кнопкой «Менеджер связался», интерес — без", async () => {
    const mk = (kind: string) => ({
      lead: {
        findUnique: vi.fn(async () => ({
          id: "L1",
          kind,
          createdById: "p1",
          requestedSlabs: 3,
          requestedAreaM2: null,
          siteText: null,
          dueDate: null,
          note: null,
          contact: null,
          stoneCode: "ONX-7K3QD",
          createdBy: { name: "Азиз", role: "PARTNER", partnerType: "DESIGNER" },
          stoneType: { name: "Травертин", code: "ONX-AAAAA" },
        })),
      },
      user: {
        findUnique: vi.fn(async () => ({ partnerManager: { telegramId: "555", isActive: true, role: "MANAGER" } })),
        findMany: vi.fn(async () => []),
      },
    });
    const send = vi.fn(async (_chat: string, _text: string, _opts?: unknown) => ({ ok: true }) as never);
    expect(await notifyPartnerLeadSafe(mk("REQUEST") as never, send, "L1")).toBe(1);
    expect(send.mock.calls[0][0]).toBe("555");
    expect(JSON.stringify(send.mock.calls[0][2])).toContain("Менеджер связался");
    send.mockClear();
    await notifyPartnerLeadSafe(mk("VIEW") as never, send, "L1");
    expect(send.mock.calls[0][2]).toBeUndefined();
  });
  it("заявка не партнёра (клиент с QR) — партнёрское уведомление не шлётся", async () => {
    const db = {
      lead: { findUnique: vi.fn(async () => ({ id: "L1", kind: "REQUEST", createdById: null, createdBy: null })) },
      user: { findUnique: vi.fn(), findMany: vi.fn() },
    };
    const send = vi.fn();
    expect(await notifyPartnerLeadSafe(db as never, send as never, "L1")).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("сбой БД не роняет (заявка уже сохранена)", async () => {
    const db = { lead: { findUnique: vi.fn(async () => { throw new Error("db"); }) }, user: {} };
    expect(await notifyPartnerLeadSafe(db as never, vi.fn() as never, "L1")).toBe(0);
  });
});

describe("§13.3 заявка → продажа", () => {
  const lead = (over: Record<string, unknown> = {}) => ({
    id: "L1",
    kind: "REQUEST",
    status: "CONTACTED",
    saleRecordId: null,
    requestedSlabs: 10,
    requestedAreaM2: { toString: () => "25.5" },
    siteText: "ЖК Олмазор",
    dueDate: null,
    stoneType: { id: "st1", name: "Травертин" },
    createdBy: { name: "Азиз", role: "PARTNER", partnerType: "FOREMAN" },
    ...over,
  });
  const dbWith = (row: unknown) => ({ lead: { findUnique: vi.fn(async () => row) } });

  it("префилл: камень, объём, объект", async () => {
    const p = await loadLeadSalePrefill(dbWith(lead()) as never, "L1");
    expect(p).toMatchObject({
      leadId: "L1",
      stoneTypeId: "st1",
      qtySlabs: "10",
      qtyAreaM2: "25,5",
      siteText: "ЖК Олмазор",
      partnerName: "Азиз",
      partnerType: "FOREMAN",
    });
  });
  it("закрытая / уже проданная / не партнёра / интерес — без префилла", async () => {
    for (const over of [
      { status: "CLOSED" },
      { saleRecordId: "s1" },
      { createdBy: { name: "x", role: "MANAGER", partnerType: null } },
      { kind: "VIEW" },
      { stoneType: null },
    ]) {
      expect(await loadLeadSalePrefill(dbWith(lead(over)) as never, "L1")).toBeNull();
    }
    expect(await loadLeadSalePrefill(dbWith(lead()) as never, "")).toBeNull();
  });

  it("после продажи заявка закрывается со ссылкой и пишется в «Историю»", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const auditCreate = vi.fn(async () => ({}));
    const db = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ lead: { updateMany }, auditLog: { create: auditCreate } }),
    };
    const ok = await closeLeadWithSale(db as never, { leadId: "L1", saleId: "s1", managerId: "m1", stoneTypeId: "st1" });
    expect(ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "L1", kind: "REQUEST", status: { not: "CLOSED" }, saleRecordId: null, stoneTypeId: "st1" },
      data: { status: "CLOSED", saleRecordId: "s1", assignedManagerId: "m1" },
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });
  it("заявка уже закрыта / другой камень — ничего не меняется", async () => {
    const auditCreate = vi.fn();
    const db = {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ lead: { updateMany: async () => ({ count: 0 }) }, auditLog: { create: auditCreate } }),
    };
    expect(await closeLeadWithSale(db as never, { leadId: "L1", saleId: "s1", managerId: "m1", stoneTypeId: "x" })).toBe(false);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

describe("«Сводка» → «Партнёры»", () => {
  it("заявки, интересы, продажи по заявкам; сум и $ раздельно, без возвратов", async () => {
    const db = {
      user: {
        findMany: vi.fn(async () => [
          { id: "p1", name: "Азиз", isActive: true, partnerType: "FOREMAN", partnerManager: { name: "Бобур" } },
          { id: "p2", name: "Студия", isActive: false, partnerType: "DESIGNER", partnerManager: null },
        ]),
      },
      lead: {
        groupBy: vi.fn(async () => [
          { createdById: "p1", kind: "REQUEST", _count: { _all: 3 } },
          { createdById: "p1", kind: "VIEW", _count: { _all: 5 } },
          { createdById: "p1", kind: "TEXTURE_DOWNLOAD", _count: { _all: 2 } },
          { createdById: "p2", kind: "REQUEST", _count: { _all: 1 } },
        ]),
        findMany: vi.fn(async () => [
          { createdById: "p1", saleRecord: { price: "10000000.00", returnedAmount: "1000000.00", currency: "UZS", returnedAt: null } },
          { createdById: "p1", saleRecord: { price: "300.10", returnedAmount: "0", currency: "USD", returnedAt: null } },
          { createdById: "p1", saleRecord: { price: "999", returnedAmount: "0", currency: "USD", returnedAt: new Date() } },
        ]),
      },
    };
    const rows = await loadPartnerSummary(db as never, { from: null, to: null });
    expect(rows).toEqual([
      {
        partnerId: "p1",
        name: "Азиз",
        type: "FOREMAN",
        managerName: "Бобур",
        requests: 3,
        interests: 7,
        sales: 2,
        amountUzs: 9000000,
        amountUsd: 300.1,
      },
      {
        partnerId: "p2",
        name: "Студия (отключён)",
        type: "DESIGNER",
        managerName: null,
        requests: 1,
        interests: 0,
        sales: 0,
        amountUzs: 0,
        amountUsd: 0,
      },
    ]);
  });
});
