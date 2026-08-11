// ТЗ №16 A · «Отправить в шоу-рум → из партии».
//
// Что закрывает: по ADR-004 камень живёт партиями, поимённая плита выделяется
// только когда понадобилась. Витрина показывала ТОЛЬКО уже выделенные плиты —
// на весь склад их была одна (ТЗ №16 §2). Теперь плита берётся из любой партии.
//
// Главный инвариант этого файла — АТОМАРНОСТЬ. Выделение и отправка обязаны
// идти одной транзакцией: между ними свежая плита стоит AVAILABLE, и параллельная
// продажа успела бы её забрать. Это та же дыра двойной продажи, которую в ТЗ №15
// закрывают условные updateMany.
import { beforeEach, describe, expect, it, vi } from "vitest";

const txCalls: string[] = [];

const queryRaw = vi.fn().mockResolvedValue([]);
const userFindUnique = vi.fn();
const batchFindUnique = vi.fn();
const slabCreate = vi.fn();
const slabUpdateMany = vi.fn();
const slabFindUnique = vi.fn();
const showroomPlacementCreate = vi.fn();
const shipmentCreate = vi.fn();
const auditCreate = vi.fn();

/** Один общий tx — если бы код открыл вторую транзакцию, счётчик бы вырос. */
let transactionCount = 0;

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      const tx = {
        $queryRaw: (...a: unknown[]) => {
          txCalls.push("lock");
          return queryRaw(...a);
        },
        user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
        batch: { findUnique: (...a: unknown[]) => batchFindUnique(...a) },
        slab: {
          create: (...a: unknown[]) => {
            txCalls.push("slab.create");
            return slabCreate(...a);
          },
          updateMany: (...a: unknown[]) => {
            txCalls.push("slab.updateMany");
            return slabUpdateMany(...a);
          },
          findUnique: (...a: unknown[]) => slabFindUnique(...a),
        },
        piece: { updateMany: vi.fn(), findUnique: vi.fn() },
        showroomPlacement: {
          create: (...a: unknown[]) => showroomPlacementCreate(...a),
        },
        shipment: { create: (...a: unknown[]) => shipmentCreate(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
      };
      return fn(tx);
    },
  },
}));

import {
  MAX_SHOWROOM_FROM_BATCH,
  sendBatchSlabToShowroom,
} from "@/lib/showroom";

const BATCH = {
  id: "b1",
  stoneTypeId: "st1",
  needsCheck: false,
  locations: [{ block: "А", landmark: "2" }],
};

/** Партия со свободным остатком (для guard §3 внутри separateSlabInTx). */
function batchRemainder(over: Record<string, unknown> = {}) {
  return {
    slabsTotal: 10,
    areaTotalM2: null,
    slabsAdjusted: 0,
    areaAdjustedM2: 0,
    slabsSoldDirect: 0,
    areaSoldDirectM2: 0,
    lengthMm: 275,
    widthMm: 185,
    thicknessMm: "1.8",
    slabs: [],
    pieces: [],
    ...over,
  };
}

beforeEach(() => {
  txCalls.length = 0;
  transactionCount = 0;
  vi.clearAllMocks();
  queryRaw.mockResolvedValue([]);
  userFindUnique.mockResolvedValue({ id: "u1", role: "MANAGER", isActive: true });
  // batch.findUnique зовут дважды: сама витрина и separateSlabInTx (остаток).
  batchFindUnique.mockImplementation((args: { select?: Record<string, unknown> }) =>
    args?.select && "locations" in args.select
      ? Promise.resolve(BATCH)
      : Promise.resolve(batchRemainder()),
  );
  slabCreate.mockResolvedValue({ id: "slab-new" });
  slabUpdateMany.mockResolvedValue({ count: 1 });
  slabFindUnique.mockResolvedValue({ block: "А", landmark: "2" });
  showroomPlacementCreate.mockResolvedValue({ id: "pl1" });
  shipmentCreate.mockResolvedValue({ id: "ship1" });
  auditCreate.mockResolvedValue({});
});

describe("sendBatchSlabToShowroom — атомарность", () => {
  it("выделение и отправка проходят ОДНОЙ транзакцией", async () => {
    const res = await sendBatchSlabToShowroom({
      batchId: "b1",
      actorId: "u1",
      standNote: "витрина 1",
    });

    expect(res.ok).toBe(true);
    // Одна транзакция на всю операцию — не две.
    expect(transactionCount).toBe(1);
  });

  it("порядок: замок партии → создание плиты → перевод в SHOWROOM", async () => {
    await sendBatchSlabToShowroom({ batchId: "b1", actorId: "u1" });

    const lock = txCalls.indexOf("lock");
    const create = txCalls.indexOf("slab.create");
    const toShowroom = txCalls.indexOf("slab.updateMany");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(create);
    expect(create).toBeLessThan(toShowroom);
  });

  it("перевод в шоу-рум условный: WHERE status=AVAILABLE, needsCheck=false", async () => {
    await sendBatchSlabToShowroom({ batchId: "b1", actorId: "u1" });

    expect(slabUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "slab-new", status: "AVAILABLE", needsCheck: false },
      data: { status: "SHOWROOM" },
    });
  });
});

describe("sendBatchSlabToShowroom — количество", () => {
  it("по умолчанию берётся одна плита", async () => {
    const res = await sendBatchSlabToShowroom({ batchId: "b1", actorId: "u1" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.slabs).toHaveLength(1);
    expect(slabCreate).toHaveBeenCalledTimes(1);
  });

  it("qty=3 → три плиты, три размещения на витрине", async () => {
    const res = await sendBatchSlabToShowroom({
      batchId: "b1",
      qty: 3,
      actorId: "u1",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.slabs).toHaveLength(3);
    expect(slabCreate).toHaveBeenCalledTimes(3);
    expect(showroomPlacementCreate).toHaveBeenCalledTimes(3);
  });

  it("qty=0 и дробное — отказ до похода в БД", async () => {
    for (const qty of [0, -1, 1.5]) {
      const res = await sendBatchSlabToShowroom({
        batchId: "b1",
        qty,
        actorId: "u1",
      });
      expect(res.ok).toBe(false);
    }
    expect(transactionCount).toBe(0);
  });

  it("выше потолка — отказ (цикл ограничен)", async () => {
    const res = await sendBatchSlabToShowroom({
      batchId: "b1",
      qty: MAX_SHOWROOM_FROM_BATCH + 1,
      actorId: "u1",
    });

    expect(res.ok).toBe(false);
    expect(transactionCount).toBe(0);
  });
});

describe("sendBatchSlabToShowroom — отказы", () => {
  it("остаток партии исчерпан → внятная причина, ничего не создано", async () => {
    batchFindUnique.mockImplementation((args: { select?: Record<string, unknown> }) =>
      args?.select && "locations" in args.select
        ? Promise.resolve(BATCH)
        : Promise.resolve(batchRemainder({ slabsTotal: 10, slabsSoldDirect: 10 })),
    );

    const res = await sendBatchSlabToShowroom({ batchId: "b1", actorId: "u1" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain("не осталось свободных плит");
    expect(showroomPlacementCreate).not.toHaveBeenCalled();
  });

  it("партия не найдена → NOT_FOUND", async () => {
    batchFindUnique.mockResolvedValue(null);

    const res = await sendBatchSlabToShowroom({ batchId: "нет", actorId: "u1" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("роль без права отправки → FORBIDDEN_ROLE, плита не выделяется", async () => {
    userFindUnique.mockResolvedValue({
      id: "p1",
      role: "PARTNER",
      isActive: true,
    });

    const res = await sendBatchSlabToShowroom({ batchId: "b1", actorId: "p1" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FORBIDDEN_ROLE");
    expect(slabCreate).not.toHaveBeenCalled();
  });

  it("пустой batchId → INVALID_INPUT", async () => {
    const res = await sendBatchSlabToShowroom({ batchId: "  ", actorId: "u1" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("INVALID_INPUT");
  });
});

describe("sendBatchSlabToShowroom — данные новой плиты", () => {
  it("плита выделяется без фотозапроса (ТЗ №16 A1)", async () => {
    await sendBatchSlabToShowroom({ batchId: "b1", actorId: "u1" });

    expect(slabCreate.mock.calls[0][0].data.photoRequestId).toBeNull();
  });

  it("локация берётся у партии", async () => {
    await sendBatchSlabToShowroom({ batchId: "b1", actorId: "u1" });

    expect(slabCreate.mock.calls[0][0].data).toMatchObject({
      block: "А",
      landmark: "2",
    });
  });

  it("у партии нет локаций → «?», операция не падает", async () => {
    batchFindUnique.mockImplementation((args: { select?: Record<string, unknown> }) =>
      args?.select && "locations" in args.select
        ? Promise.resolve({ ...BATCH, locations: [] })
        : Promise.resolve(batchRemainder()),
    );

    const res = await sendBatchSlabToShowroom({ batchId: "b1", actorId: "u1" });

    expect(res.ok).toBe(true);
    expect(slabCreate.mock.calls[0][0].data.block).toBe("?");
  });

  it("действие попадает в Историю как SHOWROOM_SEND", async () => {
    await sendBatchSlabToShowroom({ batchId: "b1", actorId: "u1" });

    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "SHOWROOM_SEND",
      entityType: "Slab",
      entityId: "slab-new",
    });
  });
});
