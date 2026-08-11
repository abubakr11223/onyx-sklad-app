// ТЗ №16 §4 — форма «Отправить в шоу-рум»: три источника.
//
// Здесь же зафиксирован починенный баг: выпадающий список слал одно поле
// `unitPick` вида «SLAB:<id>», а действие читало `targetType`/`unitId`, которые
// никто не заполнял. Форма всегда падала в «Неверный тип камня» — и это было
// описано в подсказке под ней как норма («если форма не разобрала выбор…»).
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.fn();
const currentActorId = vi.fn();
const sendToShowroom = vi.fn();
const sendBatchSlabToShowroom = vi.fn();
const notifyWarehouseSafe = vi.fn();
const revalidatePath = vi.fn();

class RedirectError extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));
vi.mock("@/lib/session", () => ({
  getCapabilities: (...a: unknown[]) => getCapabilities(...a),
  currentActorId: (...a: unknown[]) => currentActorId(...a),
}));
vi.mock("@/lib/shipment-notify-hook", () => ({
  notifyWarehouseSafe: (...a: unknown[]) => notifyWarehouseSafe(...a),
}));
vi.mock("@/lib/showroom", () => ({
  sendToShowroom: (...a: unknown[]) => sendToShowroom(...a),
  sendBatchSlabToShowroom: (...a: unknown[]) => sendBatchSlabToShowroom(...a),
  returnFromShowroom: vi.fn(),
  ShowroomError: class extends Error {},
}));
vi.mock("@/lib/sales", () => ({ sellUnit: vi.fn() }));
vi.mock("@/lib/samples", () => ({ issueSample: vi.fn() }));

import { sendToShowroomAction } from "@/app/shourum/actions";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function run(fields: Record<string, string>): Promise<string> {
  try {
    await sendToShowroomAction(fd(fields));
  } catch (e) {
    if (e instanceof RedirectError) return e.url;
    throw e;
  }
  throw new Error("ожидался redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  getCapabilities.mockResolvedValue({ canSendToShowroom: true });
  currentActorId.mockResolvedValue("u1");
  sendToShowroom.mockResolvedValue({
    ok: true,
    placementId: "pl1",
    shipmentId: "sh1",
  });
  sendBatchSlabToShowroom.mockResolvedValue({
    ok: true,
    slabs: [{ slabId: "s1", placementId: "pl1", shipmentId: "sh1" }],
  });
});

describe("источник «готовая плита» — разбор unitPick (починенный баг)", () => {
  it("«SLAB:<id>» из списка разбирается сервером", async () => {
    const url = await run({ source: "UNIT", unitPick: "SLAB:slab-7" });

    expect(url).toBe("/shourum?ok=sent");
    expect(sendToShowroom).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "SLAB", unitId: "slab-7" }),
    );
  });

  it("«PIECE:<id>» — бой/остаток тоже можно выставить (ТЗ №16 §4)", async () => {
    await run({ source: "UNIT", unitPick: "PIECE:piece-3" });

    expect(sendToShowroom).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "PIECE", unitId: "piece-3" }),
    );
  });

  it("явные поля (быстрые кнопки) по-прежнему работают", async () => {
    await run({ source: "UNIT", targetType: "SLAB", unitId: "slab-9" });

    expect(sendToShowroom).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "SLAB", unitId: "slab-9" }),
    );
  });

  it("мусор в unitPick → внятный отказ, а не отправка", async () => {
    const url = await run({ source: "UNIT", unitPick: "чтотоне-то" });

    expect(url).toContain("err=");
    expect(sendToShowroom).not.toHaveBeenCalled();
  });
});

describe("источник «из партии» (ТЗ №16 §4)", () => {
  it("партия + количество уходят в доменную функцию", async () => {
    const url = await run({
      source: "BATCH",
      batchId: "b1",
      qty: "2",
      standNote: "витрина у входа",
    });

    expect(url).toBe("/shourum?ok=sent");
    expect(sendBatchSlabToShowroom).toHaveBeenCalledWith({
      batchId: "b1",
      qty: 2,
      actorId: "u1",
      standNote: "витрина у входа",
    });
    // Обычная отправка единицы при этом НЕ вызывается.
    expect(sendToShowroom).not.toHaveBeenCalled();
  });

  it("пустое количество → по умолчанию одна плита", async () => {
    await run({ source: "BATCH", batchId: "b1", qty: "" });

    expect(sendBatchSlabToShowroom).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 1 }),
    );
  });

  it("дробное количество → отказ до обращения к домену", async () => {
    const url = await run({ source: "BATCH", batchId: "b1", qty: "1,5" });

    expect(url).toContain("err=");
    expect(sendBatchSlabToShowroom).not.toHaveBeenCalled();
  });

  it("партия не выбрана → отказ", async () => {
    const url = await run({ source: "BATCH", batchId: "" });

    expect(url).toContain("err=");
    expect(sendBatchSlabToShowroom).not.toHaveBeenCalled();
  });

  it("на каждую выделенную плиту уходит задача складчику (ТЗ №15 §8.2)", async () => {
    sendBatchSlabToShowroom.mockResolvedValue({
      ok: true,
      slabs: [
        { slabId: "s1", placementId: "p1", shipmentId: "sh1" },
        { slabId: "s2", placementId: "p2", shipmentId: "sh2" },
      ],
    });

    await run({ source: "BATCH", batchId: "b1", qty: "2" });

    expect(notifyWarehouseSafe).toHaveBeenCalledTimes(2);
    expect(notifyWarehouseSafe).toHaveBeenCalledWith("sh1", "u1");
    expect(notifyWarehouseSafe).toHaveBeenCalledWith("sh2", "u1");
  });

  it("отказ домена (нет свободных плит) показывается пользователю", async () => {
    sendBatchSlabToShowroom.mockResolvedValue({
      ok: false,
      error: { code: "UNIT_UNAVAILABLE", message: "В партии не осталось свободных плит" },
    });

    const url = await run({ source: "BATCH", batchId: "b1" });

    expect(decodeURIComponent(url)).toContain("не осталось свободных плит");
    expect(notifyWarehouseSafe).not.toHaveBeenCalled();
  });
});

describe("доступ", () => {
  it("без права отправки — отказ до всего остального", async () => {
    getCapabilities.mockResolvedValue({ canSendToShowroom: false });

    const url = await run({ source: "BATCH", batchId: "b1" });

    expect(url).toContain("err=");
    expect(sendBatchSlabToShowroom).not.toHaveBeenCalled();
    expect(sendToShowroom).not.toHaveBeenCalled();
  });
});
