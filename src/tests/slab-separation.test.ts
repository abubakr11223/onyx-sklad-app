// Аудит ТЗ №7 #1 — выделение плиты (separateSlabGuarded): транзакция + batch-lock
// + guard свободного остатка §3. Мок-tx (реальный db не нужен): проверяем, что
// при исчерпанном остатке плита НЕ создаётся, а иначе создаётся с верным «Плита №N».
import { describe, expect, it, vi } from "vitest";
import {
  separateSlabGuarded,
  separateSlabWithPhoto,
  SlabSeparationError,
  type SeparateSlabInput,
} from "@/lib/slab-separation";

const INPUT: SeparateSlabInput = {
  batchId: "b1",
  stoneTypeId: "st1",
  photoRequestId: "req1",
  block: "А",
  landmark: "2",
  needsCheck: false,
  separatedById: "w1",
};

interface BatchState {
  slabsTotal: number | null;
  areaTotalM2: unknown; // Decimal|null — тут число|null (toString в проде)
  slabsAdjusted: number;
  areaAdjustedM2: unknown;
  slabsSoldDirect: number;
  areaSoldDirectM2: unknown;
  /** ТЗ №16 A1 — габариты партии, наследуются плитой. */
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: unknown;
  slabs: Array<{ areaM2: unknown }>;
  pieces: Array<{ areaM2: unknown }>;
}

function batch(over: Partial<BatchState> = {}): BatchState {
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

/** Мок-db: $transaction(cb) сразу зовёт cb с мок-tx; фиксируем вызовы. */
function makeDb(batchOrNull: BatchState | null) {
  const queryRaw = vi.fn().mockResolvedValue([]); // lockBatchForUpdate
  const findUnique = vi.fn().mockResolvedValue(batchOrNull);
  const slabCreate = vi.fn().mockResolvedValue({ id: "slabNew" });
  const photoCreate = vi.fn().mockResolvedValue({ id: "ph1" });
  const tx = {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    batch: { findUnique: (...a: unknown[]) => findUnique(...a) },
    slab: { create: (...a: unknown[]) => slabCreate(...a) },
    photo: { create: (...a: unknown[]) => photoCreate(...a) },
  };
  const db = {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Parameters<typeof separateSlabGuarded>[1];
  return { db, queryRaw, findUnique, slabCreate, photoCreate };
}

describe("separateSlabGuarded — guard свободного остатка §3 (ТЗ №7 #1)", () => {
  it("остаток=0 (партия распродана) → INSUFFICIENT_REMAINDER, плита НЕ создаётся", async () => {
    // slabsTotal=10, всё продано напрямую (slabsSoldDirect=10) → slabsFree=0;
    // с новой плитой стало бы 10−10−1 = −1 → выделять нечего.
    const { db, slabCreate, queryRaw, findUnique } = makeDb(
      batch({ slabsTotal: 10, slabsSoldDirect: 10 }),
    );

    await expect(separateSlabGuarded(INPUT, db)).rejects.toMatchObject({
      name: "SlabSeparationError",
      code: "INSUFFICIENT_REMAINDER",
    });
    // Плита НЕ вставлена — остаток не ушёл в минус (нет oversell).
    expect(slabCreate).not.toHaveBeenCalled();
    // Замок взят ДО чтения (lock-first).
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUnique.mock.invocationCallOrder[0],
    );
  });

  it("остаток>0 → плита создаётся, label «Плита №1», возвращается id", async () => {
    const { db, slabCreate } = makeDb(
      batch({ slabsTotal: 10, slabsSoldDirect: 0, slabs: [] }),
    );

    const id = await separateSlabGuarded(INPUT, db);

    expect(id).toBe("slabNew");
    expect(slabCreate).toHaveBeenCalledTimes(1);
    expect(slabCreate.mock.calls[0][0].data).toMatchObject({
      batchId: "b1",
      stoneTypeId: "st1",
      label: "Плита №1",
      block: "А",
      landmark: "2",
      needsCheck: false,
      photoRequestId: "req1",
      separatedById: "w1",
    });
  });

  it("нумерация «Плита №N» = существующие плиты + 1 (под row-lock, без гонки)", async () => {
    // Уже 2 плиты выделено → новая №3; остаток 10−0−(2+1) = 7 ≥ 0 → ок.
    const { db, slabCreate } = makeDb(
      batch({
        slabsTotal: 10,
        slabsSoldDirect: 0,
        slabs: [{ areaM2: null }, { areaM2: null }],
      }),
    );

    await separateSlabGuarded(INPUT, db);

    expect(slabCreate.mock.calls[0][0].data.label).toBe("Плита №3");
  });

  it("последнюю свободную плиту выделить МОЖНО (slabsFree после = 0, не < 0)", async () => {
    // slabsTotal=10, продано 9 → 1 свободна; новая плита → slabsFree = 10−9−1 = 0.
    const { db, slabCreate } = makeDb(
      batch({ slabsTotal: 10, slabsSoldDirect: 9 }),
    );

    await expect(separateSlabGuarded(INPUT, db)).resolves.toBe("slabNew");
    expect(slabCreate).toHaveBeenCalledTimes(1);
  });

  it("остаток есть по плитам, но исчерпан по площади → INSUFFICIENT_REMAINDER", async () => {
    // slabsTotal=5 (slabsFree=4 ок), но areaTotalM2=10 всё продано (areaSoldDirectM2=10):
    // новая плита берёт среднюю площадь 10/5=2 → areaFree = 10−10−2 = −2 < 0.
    const { db, slabCreate } = makeDb(
      batch({
        slabsTotal: 5,
        areaTotalM2: 10,
        slabsSoldDirect: 0,
        areaSoldDirectM2: 10,
      }),
    );

    await expect(separateSlabGuarded(INPUT, db)).rejects.toMatchObject({
      code: "INSUFFICIENT_REMAINDER",
    });
    expect(slabCreate).not.toHaveBeenCalled();
  });

  it("партия не найдена → BATCH_NOT_FOUND, плита не создаётся", async () => {
    const { db, slabCreate } = makeDb(null);

    await expect(separateSlabGuarded(INPUT, db)).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND",
    });
    expect(slabCreate).not.toHaveBeenCalled();
  });

  it("W10-B separateSlabWithPhoto — slab + photo.SLAB bitta TX (atomik)", async () => {
    const { db, slabCreate, photoCreate } = makeDb(
      batch({ slabsTotal: 10, slabsSoldDirect: 0 }),
    );

    const id = await separateSlabWithPhoto(
      INPUT,
      { storageKey: "tg_file_abc", takenById: "w1" },
      db,
    );

    expect(id).toBe("slabNew");
    expect(slabCreate).toHaveBeenCalledTimes(1);
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(photoCreate.mock.calls[0][0].data).toMatchObject({
      storageKey: "tg_file_abc",
      kind: "SLAB",
      takenById: "w1",
      stoneTypeId: "st1",
      slabId: "slabNew",
      photoRequestId: "req1",
    });
  });

  it("W10-B photo.create yiqilsa → slab create chaqirilgan bo'lsa ham throw (TX rollback mock)", async () => {
    // Real Postgres rolls back; mock runs sequential — we assert photo throw propagates
    // so caller never treats separation as success without photo.
    const { db, photoCreate } = makeDb(
      batch({ slabsTotal: 10, slabsSoldDirect: 0 }),
    );
    photoCreate.mockRejectedValueOnce(new Error("photo write failed"));

    await expect(
      separateSlabWithPhoto(
        INPUT,
        { storageKey: "x", takenById: "w1" },
        db,
      ),
    ).rejects.toThrow("photo write failed");
  });

  it("SlabSeparationError — инстанс с кодом (бот покажет своё сообщение)", () => {
    const e = new SlabSeparationError("INSUFFICIENT_REMAINDER", "msg");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("INSUFFICIENT_REMAINDER");
  });
});

// ───────────────────────── ТЗ №16 A1 ─────────────────────────
// Механизм выделения был приварен к фотозапросу (photoRequestId обязателен),
// хотя в схеме `Slab.photoRequestId` давно `String?`. Из-за этого шоу-рум и
// «Разбить → Плита» показывали одну-единственную плиту (ТЗ №16 §2): весь
// остальной камень живёт внутри партий и выделить его было нечем.
describe("ТЗ №16 A1 — выделение без фотозапроса", () => {
  it("photoRequestId можно не передавать → плита создаётся с null", async () => {
    const { db, slabCreate } = makeDb(batch());
    const { photoRequestId: _drop, ...withoutRequest } = INPUT;

    const id = await separateSlabGuarded(withoutRequest, db);

    expect(id).toBe("slabNew");
    expect(slabCreate.mock.calls[0][0].data.photoRequestId).toBeNull();
  });

  it("явный null тоже допустим (витрина / разбитие)", async () => {
    const { db, slabCreate } = makeDb(batch());

    await separateSlabGuarded({ ...INPUT, photoRequestId: null }, db);

    expect(slabCreate.mock.calls[0][0].data.photoRequestId).toBeNull();
  });

  it("фотозапрос по-прежнему связывается, когда он есть", async () => {
    const { db, slabCreate } = makeDb(batch());

    await separateSlabGuarded(INPUT, db);

    expect(slabCreate.mock.calls[0][0].data.photoRequestId).toBe("req1");
  });
});

// Габариты: без них выделенная плита не находится поиском по размеру
// (poisk-search фильтрует по lengthMm/widthMm), то есть витрина отдавала бы
// камень, который менеджер потом не подберёт под заказ. ТЗ №12 сделал размеры
// партии обязательными — значит наследовать всегда есть что.
describe("ТЗ №16 A1 — плита наследует габариты партии", () => {
  it("длина, ширина и толщина копируются с партии", async () => {
    const { db, slabCreate } = makeDb(
      batch({ lengthMm: 275, widthMm: 185, thicknessMm: "1.8" }),
    );

    await separateSlabGuarded(INPUT, db);

    const data = slabCreate.mock.calls[0][0].data;
    expect(data.lengthMm).toBe(275);
    expect(data.widthMm).toBe(185);
    expect(data.thicknessMm).toBe("1.8");
  });

  it("у партии габаритов нет (старые записи) → плита остаётся без них, без падения", async () => {
    const { db, slabCreate } = makeDb(
      batch({ lengthMm: null, widthMm: null, thicknessMm: null }),
    );

    await separateSlabGuarded(INPUT, db);

    const data = slabCreate.mock.calls[0][0].data;
    expect(data.lengthMm).toBeNull();
    expect(data.widthMm).toBeNull();
  });

  it("площадь НЕ копируется: у партии она общая, замер плиты придёт позже", async () => {
    const { db, slabCreate } = makeDb(batch({ areaTotalM2: 120 }));

    await separateSlabGuarded(INPUT, db);

    expect(slabCreate.mock.calls[0][0].data.areaM2).toBeUndefined();
  });
});
