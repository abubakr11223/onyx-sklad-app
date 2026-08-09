// TZ №15 §8.2 — shipment Telegram notify (fake client, no real DB / Telegram).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DISPATCH_ATTEMPTS,
  ShipmentNotifyError,
  buildShipmentTaskText,
  notifyWarehouseOfShipment,
  shipmentNotifyReceiptId,
  type ShipmentNotifyDeps,
  type ShipmentNotifyRecord,
} from "@/lib/shipment-telegram-notify";

const shipmentFindUnique = vi.fn();
const userFindMany = vi.fn();
const receiptFindUnique = vi.fn();
const receiptCreate = vi.fn();
const receiptUpdate = vi.fn();
const auditLogCreate = vi.fn();
const sendMessage = vi.fn();

function makeDeps(): ShipmentNotifyDeps {
  return {
    db: {
      shipment: {
        findUnique: (...a: unknown[]) => shipmentFindUnique(...a),
      },
      user: {
        findMany: (...a: unknown[]) => userFindMany(...a),
      },
      mutationReceipt: {
        findUnique: (...a: unknown[]) => receiptFindUnique(...a),
        create: (...a: unknown[]) => receiptCreate(...a),
        update: (...a: unknown[]) => receiptUpdate(...a),
      },
      auditLog: {
        create: (...a: unknown[]) => auditLogCreate(...a),
      },
    },
    sendMessage: (...a: unknown[]) => sendMessage(...a),
  } as unknown as ShipmentNotifyDeps;
}

const SHIP: ShipmentNotifyRecord = {
  id: "sh1",
  kind: "SALE",
  cancelledAt: null,
  completedAt: null,
  note: "срочно",
  client: { name: "Иванов" },
  manager: { name: "Менеджер А" },
  lines: [
    {
      targetType: "SLAB",
      locationSnapshot: "Блок А, ориентир 2",
      qtyOrderedSlabs: 1,
      qtyOrderedAreaM2: null,
      slab: { label: "Плита №3", stoneType: { name: "Травертин" } },
      piece: null,
      batch: null,
    },
  ],
};

beforeEach(() => {
  shipmentFindUnique.mockReset();
  userFindMany.mockReset();
  receiptFindUnique.mockReset();
  receiptCreate.mockReset();
  receiptUpdate.mockReset();
  auditLogCreate.mockReset();
  sendMessage.mockReset();

  shipmentFindUnique.mockResolvedValue(SHIP);
  userFindMany.mockResolvedValue([
    { id: "w1", telegramId: "111", name: "Склад 1", phone: "+998901111111" },
    { id: "w2", telegramId: "222", name: "Склад 2", phone: "+998902222222" },
  ]);
  receiptFindUnique.mockResolvedValue(null);
  receiptCreate.mockResolvedValue({});
  receiptUpdate.mockResolvedValue({});
  auditLogCreate.mockResolvedValue({});
  sendMessage.mockResolvedValue({ ok: true, messageId: 9001 });
});

describe("buildShipmentTaskText", () => {
  it("includes kind, stone, location, client, manager, note", () => {
    const t = buildShipmentTaskText(SHIP);
    expect(t).toContain("Продажа");
    expect(t).toContain("Травертин");
    expect(t).toContain("Плита №3");
    expect(t).toContain("Блок А, ориентир 2");
    expect(t).toContain("Иванов");
    expect(t).toContain("Менеджер А");
    expect(t).toContain("срочно");
    expect(t).toContain("К отгрузке");
  });

  it("marks SAMPLE as ОБРАЗЕЦ", () => {
    const t = buildShipmentTaskText({ ...SHIP, kind: "SAMPLE" });
    expect(t).toContain("ОБРАЗЕЦ");
  });
});

describe("shipmentNotifyReceiptId", () => {
  it("stable key for (shipment, chat)", () => {
    expect(shipmentNotifyReceiptId("sh1", "111")).toBe(
      "SHIPMENT_NOTIFY:sh1:111",
    );
  });
});

describe("notifyWarehouseOfShipment", () => {
  it("sends to each eligible warehouse worker and records receipts", async () => {
    const res = await notifyWarehouseOfShipment(
      "sh1",
      { actorId: "m1" },
      makeDeps(),
    );

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: "WAREHOUSE",
          isActive: true,
          telegramId: { not: null },
        },
        take: 50,
      }),
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toBe("111");
    expect(sendMessage.mock.calls[0][1]).toContain("Травертин");
    expect(receiptCreate).toHaveBeenCalledTimes(2);
    expect(receiptCreate.mock.calls[0][0].data).toMatchObject({
      mutationId: "SHIPMENT_NOTIFY:sh1:111",
      kind: "SHIPMENT_NOTIFY",
      entityType: "Shipment",
      entityId: "sh1",
      resultJson: expect.objectContaining({ status: "SENT", attempts: 1 }),
    });
    expect(auditLogCreate).toHaveBeenCalled();
    expect(res.dispatchedTo).toBe(2);
    expect(res.noWorkers).toBe(false);
    expect(res.attemptedSends).toBe(2);
    expect(res.recipients).toHaveLength(2);
    expect(res.recipients[0]).toMatchObject({
      delivered: true,
      isDemoAccount: false,
      skipped: false,
    });
  });

  it("never silent: noWorkers when only demo warehouse linked", async () => {
    userFindMany.mockResolvedValue([
      {
        id: "demo",
        telegramId: "999",
        name: "Бахтиёр (демо)",
        phone: "+998900000002",
      },
    ]);

    const res = await notifyWarehouseOfShipment(
      "sh1",
      { actorId: "m1" },
      makeDeps(),
    );

    expect(sendMessage).not.toHaveBeenCalled();
    expect(res.noWorkers).toBe(true);
    expect(res.dispatchedTo).toBe(0);
    expect(res.skippedDemoCount).toBe(1);
    expect(res.recipients[0]).toMatchObject({
      isDemoAccount: true,
      skipped: true,
      delivered: false,
    });
    // Visible audit for creator — not swallowed.
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SHIPMENT_CONFIRM",
          entityId: "sh1",
          payload: expect.objectContaining({
            event: "telegram_task_dispatch",
            noWorkers: true,
          }),
        }),
      }),
    );
  });

  it("never silent: noWorkers when nobody linked", async () => {
    userFindMany.mockResolvedValue([]);
    const res = await notifyWarehouseOfShipment("sh1", {}, makeDeps());
    expect(res.noWorkers).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalled();
  });

  it("idempotent: SENT receipt → no second send on retry", async () => {
    receiptFindUnique.mockImplementation(
      async (args: { where: { mutationId: string } }) => {
        if (args.where.mutationId.endsWith(":111")) {
          return {
            mutationId: args.where.mutationId,
            resultJson: {
              status: "SENT",
              attempts: 1,
              lastError: null,
              messageId: 1,
              chatId: "111",
              shipmentId: "sh1",
            },
          };
        }
        return null;
      },
    );

    const res = await notifyWarehouseOfShipment(
      "sh1",
      { actorId: "m1" },
      makeDeps(),
    );

    // Only chat 222 is sent now; 111 skipped.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe("222");
    expect(res.dispatchedTo).toBe(2); // 111 already SENT + 222 new SENT
    expect(res.attemptedSends).toBe(1);
    expect(receiptCreate).toHaveBeenCalledTimes(1);
  });

  it("FAILED under max attempts → retry updates receipt", async () => {
    userFindMany.mockResolvedValue([
      { id: "w1", telegramId: "111", name: "Склад 1", phone: "+998901111111" },
    ]);
    receiptFindUnique.mockResolvedValue({
      mutationId: "SHIPMENT_NOTIFY:sh1:111",
      resultJson: {
        status: "FAILED",
        attempts: 1,
        lastError: "timeout",
        messageId: null,
        chatId: "111",
        shipmentId: "sh1",
      },
    });
    sendMessage.mockResolvedValue({ ok: true, messageId: 42 });

    const res = await notifyWarehouseOfShipment("sh1", {}, makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mutationId: "SHIPMENT_NOTIFY:sh1:111" },
        data: {
          resultJson: expect.objectContaining({
            status: "SENT",
            attempts: 2,
          }),
        },
      }),
    );
    expect(receiptCreate).not.toHaveBeenCalled();
    expect(res.dispatchedTo).toBe(1);
  });

  it("FAILED at MAX_DISPATCH_ATTEMPTS → no further send", async () => {
    userFindMany.mockResolvedValue([
      { id: "w1", telegramId: "111", name: "Склад 1", phone: "+998901111111" },
    ]);
    receiptFindUnique.mockResolvedValue({
      mutationId: "SHIPMENT_NOTIFY:sh1:111",
      resultJson: {
        status: "FAILED",
        attempts: MAX_DISPATCH_ATTEMPTS,
        lastError: "dead",
        messageId: null,
        chatId: "111",
        shipmentId: "sh1",
      },
    });

    const res = await notifyWarehouseOfShipment("sh1", {}, makeDeps());

    expect(sendMessage).not.toHaveBeenCalled();
    expect(res.dispatchedTo).toBe(0);
    expect(res.attemptedSends).toBe(0);
  });

  it("records FAILED without stopping other workers", async () => {
    sendMessage
      .mockResolvedValueOnce({ ok: false, error: "blocked" })
      .mockResolvedValueOnce({ ok: true, messageId: 7 });

    const res = await notifyWarehouseOfShipment("sh1", {}, makeDeps());

    expect(res.dispatchedTo).toBe(1);
    expect(res.attemptedSends).toBe(2);
    expect(receiptCreate.mock.calls[0][0].data.resultJson.status).toBe(
      "FAILED",
    );
    expect(receiptCreate.mock.calls[1][0].data.resultJson.status).toBe("SENT");
  });

  it("throws NOT_FOUND / CANCELLED / VALIDATION", async () => {
    shipmentFindUnique.mockResolvedValue(null);
    await expect(
      notifyWarehouseOfShipment("missing", {}, makeDeps()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    shipmentFindUnique.mockResolvedValue({
      ...SHIP,
      cancelledAt: new Date(),
    });
    await expect(
      notifyWarehouseOfShipment("sh1", {}, makeDeps()),
    ).rejects.toBeInstanceOf(ShipmentNotifyError);

    await expect(
      notifyWarehouseOfShipment("  ", {}, makeDeps()),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("bounds shipment.lines take", async () => {
    await notifyWarehouseOfShipment("sh1", {}, makeDeps());
    const args = shipmentFindUnique.mock.calls[0][0];
    expect(args.select.lines.take).toBe(20);
  });
});
