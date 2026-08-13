// ТЗ №15 §8.3 — накладная отгрузки: «что, сколько, кому, дата» + кто выдал.
//
// Главное, что здесь закрепляется, — не вёрстка, а ОБЛАСТЬ ВИДИМОСТИ. Ссылка
// на документ содержит id отгрузки, поэтому чужую накладную можно было бы
// открыть подбором. Менеджер обязан видеть только свои отгрузки — так же,
// как в списке.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadShipmentDocument, shipmentDocNumber } from "@/lib/shipments";

const shipmentFindFirst = vi.fn();
const auditFindFirst = vi.fn();

const db = {
  shipment: { findFirst: (...a: unknown[]) => shipmentFindFirst(...a) },
  auditLog: { findFirst: (...a: unknown[]) => auditFindFirst(...a) },
} as unknown as Parameters<typeof loadShipmentDocument>[0];

function shipment(over: Record<string, unknown> = {}) {
  return {
    id: "cmshipment0001abcd",
    kind: "SALE",
    note: "позвонить за час",
    createdAt: new Date("2026-08-12T05:00:00Z"),
    completedAt: null,
    cancelledAt: null,
    manager: { name: "Менеджер А" },
    client: { name: "Ахмад" },
    site: { name: "Вилла" },
    saleRecord: { customerName: "Ахмад" },
    sample: null,
    lines: [
      {
        targetType: "SLAB",
        qtyOrderedSlabs: 1,
        qtyOrderedAreaM2: null,
        qtyShippedSlabs: 0,
        qtyShippedAreaM2: "0",
        locationSnapshot: "Блок Б, ор. 1–2",
        slab: {
          label: "Плита №1",
          lengthMm: 275,
          widthMm: 185,
          thicknessMm: "1.8",
          stoneType: { name: "Травертин" },
        },
        piece: null,
        batch: null,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  shipmentFindFirst.mockResolvedValue(shipment());
  auditFindFirst.mockResolvedValue(null);
});

describe("Область видимости", () => {
  it("менеджер — запрос сужен до его отгрузок", async () => {
    await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: false,
      actorId: "mgr-A",
    });

    expect(shipmentFindFirst.mock.calls[0][0].where).toEqual({
      id: "s1",
      managerId: "mgr-A",
    });
  });

  it("владелец / склад — без сужения", async () => {
    await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: true,
      actorId: "owner",
    });

    expect(shipmentFindFirst.mock.calls[0][0].where).toEqual({ id: "s1" });
  });

  it("без актора и без права видеть всё — ничего не отдаём", async () => {
    await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: false,
      actorId: null,
    });

    expect(shipmentFindFirst.mock.calls[0][0].where.managerId).toBe("__none__");
  });

  it("чужая отгрузка → null (страница отдаст 404)", async () => {
    shipmentFindFirst.mockResolvedValue(null);

    const doc = await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: false,
      actorId: "mgr-A",
    });

    expect(doc).toBeNull();
  });

  it("пустой id — в БД не ходим", async () => {
    const doc = await loadShipmentDocument(db, {
      shipmentId: "   ",
      canSeeAll: true,
      actorId: "owner",
    });

    expect(doc).toBeNull();
    expect(shipmentFindFirst).not.toHaveBeenCalled();
  });
});

describe("Содержимое документа (ТЗ §8.3: что, сколько, кому, дата)", () => {
  it("кому, кто оформил, номер и дата", async () => {
    const doc = await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: true,
      actorId: "owner",
    });

    expect(doc?.clientName).toBe("Ахмад");
    expect(doc?.siteName).toBe("Вилла");
    expect(doc?.managerName).toBe("Менеджер А");
    expect(doc?.number).toBe(shipmentDocNumber("cmshipment0001abcd"));
    expect(doc?.createdAt).toEqual(new Date("2026-08-12T05:00:00Z"));
  });

  it("строка: камень, что именно, размер в см, заказано/отгружено", async () => {
    const doc = await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: true,
      actorId: "owner",
    });

    expect(doc?.lines).toHaveLength(1);
    const l = doc!.lines[0];
    expect(l.stoneName).toBe("Травертин");
    expect(l.what).toBe("Плита №1");
    expect(l.gabarit).toBe("275×185×1,8 см");
    expect(l.qtyOrdered).toBe("1 плит");
    expect(l.qtyShipped).toBeNull(); // ещё не выдано
    expect(l.locationSnapshot).toBe("Блок Б, ор. 1–2");
  });

  it("«кто выдал» берётся из Истории, а не из самой отгрузки", async () => {
    // В Shipment такого поля нет, и подтвердить мог не тот, кто оформлял.
    auditFindFirst.mockResolvedValue({
      createdAt: new Date("2026-08-12T09:00:00Z"),
      user: { name: "Складчик Б" },
    });

    const doc = await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: true,
      actorId: "owner",
    });

    expect(doc?.issuedByName).toBe("Складчик Б");
    expect(doc?.issuedAt).toEqual(new Date("2026-08-12T09:00:00Z"));
    expect(auditFindFirst.mock.calls[0][0].where).toMatchObject({
      action: "SHIPMENT_CONFIRM",
      entityType: "Shipment",
    });
  });

  it("ещё не подтверждено → «кто выдал» пустой, документ всё равно печатается", async () => {
    const doc = await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: true,
      actorId: "owner",
    });

    expect(doc?.issuedByName).toBeNull();
    expect(doc?.statusLabel).toBe("К отгрузке");
  });

  it("образец: тип и срок возврата на документе", async () => {
    shipmentFindFirst.mockResolvedValue(
      shipment({
        kind: "SAMPLE",
        client: null,
        saleRecord: null,
        sample: {
          returnDueDate: new Date("2026-08-20T00:00:00Z"),
          client: { name: "Дизайнер" },
        },
      }),
    );

    const doc = await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: true,
      actorId: "owner",
    });

    expect(doc?.kindLabel).toBe("Образец");
    expect(doc?.clientName).toBe("Дизайнер");
    expect(doc?.returnDueDate).toEqual(new Date("2026-08-20T00:00:00Z"));
  });

  it("шоу-рум: получатель — витрина, а не клиент", async () => {
    shipmentFindFirst.mockResolvedValue(
      shipment({ kind: "SHOWROOM", client: null, saleRecord: null }),
    );

    const doc = await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: true,
      actorId: "owner",
    });

    expect(doc?.kindLabel).toBe("Шоу-рум");
    expect(doc?.clientName).toBe("Шоу-рум");
  });

  it("объёмная продажа: размера нет, количество есть", async () => {
    shipmentFindFirst.mockResolvedValue(
      shipment({
        lines: [
          {
            targetType: "BATCH_VOLUME",
            qtyOrderedSlabs: 5,
            qtyOrderedAreaM2: "10.5",
            qtyShippedSlabs: 2,
            qtyShippedAreaM2: "4",
            locationSnapshot: null,
            slab: null,
            piece: null,
            batch: { stoneType: { name: "Оникс" } },
          },
        ],
      }),
    );

    const doc = await loadShipmentDocument(db, {
      shipmentId: "s1",
      canSeeAll: true,
      actorId: "owner",
    });

    const l = doc!.lines[0];
    expect(l.stoneName).toBe("Оникс");
    expect(l.gabarit).toBeNull();
    expect(l.qtyOrdered).toBe("5 плит · 10.5 м²");
    expect(l.qtyShipped).toBe("2 плит · 4 м²");
    expect(doc?.statusLabel).toBe("Отгружено частично");
  });
});

describe("Номер накладной", () => {
  it("короткий, заглавными — по нему ищут бумагу", () => {
    expect(shipmentDocNumber("cmshipment0001abcd")).toBe("0001ABCD");
  });
});
