// Аудит ТЗ №7 #6 — renameBlock переносит камень (BatchLocation/Slab/Piece.block)
// и #16 — materializeBlock/blockHasStone работают с нормализацией буквы.
// db и session моки; next/navigation.redirect ловим по throw'у NEXT_REDIRECT.
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── db mock: транзакция сразу зовёт cb с тем же db-mock (updateMany и др.) ──
// vi.hoisted нужен, чтобы моки существовали ДО того, как vi.mock их подтянет.
const M = vi.hoisted(() => {
  const wbFindUnique = vi.fn();
  const wbUpdate = vi.fn();
  const wbCreate = vi.fn();
  const wbAggregate = vi.fn();
  const wbDelete = vi.fn();
  const blCount = vi.fn();
  const blFindMany = vi.fn();
  const blUpdateMany = vi.fn();
  const slabUpdateMany = vi.fn();
  const pieceUpdateMany = vi.fn();
  const wlDelete = vi.fn();
  const wlCreate = vi.fn();
  const getRealSessionUser = vi.fn();
  const dbMock: Record<string, unknown> = {
    warehouseBlock: {
      findUnique: wbFindUnique,
      update: wbUpdate,
      create: wbCreate,
      aggregate: wbAggregate,
      delete: wbDelete,
    },
    batchLocation: {
      count: blCount,
      findMany: blFindMany,
      updateMany: blUpdateMany,
    },
    slab: { updateMany: slabUpdateMany },
    piece: { updateMany: pieceUpdateMany },
    warehouseLandmark: { delete: wlDelete, create: wlCreate },
  };
  dbMock.$transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(dbMock);
  return {
    wbFindUnique, wbUpdate, wbCreate, wbAggregate, wbDelete,
    blCount, blFindMany, blUpdateMany, slabUpdateMany, pieceUpdateMany,
    wlDelete, wlCreate, getRealSessionUser, dbMock,
  };
});
const {
  wbFindUnique, wbUpdate, wbCreate, wbAggregate, wbDelete,
  blCount, blFindMany, blUpdateMany, slabUpdateMany, pieceUpdateMany,
  wlDelete, wlCreate, getRealSessionUser,
} = M;

vi.mock("@/lib/db", () => ({ db: M.dbMock }));
vi.mock("@/lib/session", () => ({ getRealSessionUser: M.getRealSessionUser }));

// ── next mocks: redirect бросает NEXT_REDIRECT(location), revalidate — noop ──
class NextRedirectError extends Error {
  constructor(public location: string) {
    super("NEXT_REDIRECT");
    this.name = "NEXT_REDIRECT";
  }
}
vi.mock("next/navigation", () => ({
  redirect: (loc: string) => {
    throw new NextRedirectError(loc);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Импорт ПОСЛЕ mock'ов.
import {
  renameBlock,
  deleteBlock,
  addLandmark,
  setBlockMeta,
  addBlock,
} from "@/app/karta-sklada/actions";

/** Ждём, что action завершится редиректом на данный URL. */
async function expectRedirect(
  fn: () => Promise<void>,
  loc: string,
): Promise<void> {
  await expect(fn()).rejects.toMatchObject({
    name: "NEXT_REDIRECT",
    location: loc,
  });
}

function fd(pairs: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(pairs)) f.append(k, v);
  return f;
}

beforeEach(() => {
  wbFindUnique.mockReset();
  wbUpdate.mockReset();
  wbCreate.mockReset();
  wbAggregate.mockReset();
  wbDelete.mockReset();
  blCount.mockReset();
  blFindMany.mockReset();
  blUpdateMany.mockReset();
  slabUpdateMany.mockReset();
  pieceUpdateMany.mockReset();
  wlDelete.mockReset();
  wlCreate.mockReset();
  getRealSessionUser.mockReset();
  getRealSessionUser.mockResolvedValue({ id: "owner1", role: "OWNER" });
  // Разумные значения по умолчанию.
  wbAggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
  blFindMany.mockResolvedValue([]);
  blUpdateMany.mockResolvedValue({ count: 0 });
  slabUpdateMany.mockResolvedValue({ count: 0 });
  pieceUpdateMany.mockResolvedValue({ count: 0 });
});

// ═══════════════ #6 · renameBlock переносит камень ═══════════════

describe("renameBlock — переносит BatchLocation/Slab/Piece.block (ТЗ №7 #6)", () => {
  it("переименование «А»→«Б» ⇒ WarehouseBlock.letter + все *.block ко'chsin, одной транзакцией", async () => {
    wbFindUnique.mockResolvedValue({ letter: "А" });

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "Б" })),
      "/karta-sklada?edit=1&ok=renamed",
    );

    // WarehouseBlock переименован — 1 раз, на «Б».
    expect(wbUpdate).toHaveBeenCalledTimes(1);
    expect(wbUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: "wb1" },
      data: { letter: "Б" },
    });
    // Камень перенесён во всех трёх моделях со СТАРОЙ буквы на НОВУЮ.
    expect(blUpdateMany).toHaveBeenCalledTimes(1);
    expect(blUpdateMany.mock.calls[0][0]).toEqual({
      where: { block: "А" },
      data: { block: "Б" },
    });
    expect(slabUpdateMany).toHaveBeenCalledTimes(1);
    expect(slabUpdateMany.mock.calls[0][0]).toEqual({
      where: { block: "А" },
      data: { block: "Б" },
    });
    expect(pieceUpdateMany).toHaveBeenCalledTimes(1);
    expect(pieceUpdateMany.mock.calls[0][0]).toEqual({
      where: { block: "А" },
      data: { block: "Б" },
    });
  });

  it("no-op: та же буква после нормализации («А»→«А») ⇒ никаких update", async () => {
    wbFindUnique.mockResolvedValue({ letter: "А" });

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "А" })),
      "/karta-sklada?edit=1&ok=renamed",
    );

    expect(wbUpdate).not.toHaveBeenCalled();
    expect(blUpdateMany).not.toHaveBeenCalled();
    expect(slabUpdateMany).not.toHaveBeenCalled();
    expect(pieceUpdateMany).not.toHaveBeenCalled();
  });

  it("новая буква занята другим блоком (P2002) ⇒ err=block_taken", async () => {
    wbFindUnique.mockResolvedValue({ letter: "А" });
    // updateMany на *.block пусть отработает; конфликт кинет warehouseBlock.update.
    wbUpdate.mockRejectedValueOnce({ code: "P2002", name: "PrismaClientKnownRequestError" });
    // Пришлось bypass instanceof — соберём фейковую ошибку и обернём как надо:
    wbUpdate.mockReset();
    const { Prisma } = await import("@prisma/client");
    const conflict = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "n/a",
    });
    wbUpdate.mockRejectedValueOnce(conflict);

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "Б" })),
      "/karta-sklada?edit=1&err=block_taken",
    );
  });

  it("пустая новая буква ⇒ err=letter, камень не трогается", async () => {
    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "  " })),
      "/karta-sklada?edit=1&err=letter",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
    expect(blUpdateMany).not.toHaveBeenCalled();
  });

  it("не OWNER ⇒ err=denied, ни одной записи не трогается", async () => {
    getRealSessionUser.mockResolvedValue({ id: "u2", role: "MANAGER" });

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "Б" })),
      "/karta-sklada?edit=1&err=denied",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
    expect(blUpdateMany).not.toHaveBeenCalled();
  });
});

// ═══════════════ #16 · materializeBlock + normalizeBlockLetter ═══════════════

describe("materializeBlock — нормализация буквы (ТЗ №7 #16)", () => {
  it("addLandmark на auto-блок с латинским 'E' ⇒ WarehouseBlock создаётся под КИР «Е», ориентиры собираются из обеих форм", async () => {
    // WarehouseBlock ещё нет.
    wbFindUnique.mockResolvedValue(null);
    wbCreate.mockResolvedValue({ id: "wbNew" });
    // BatchLocation содержит ориентиры и под кир «Е», и под лат 'E' (legacy).
    blFindMany.mockResolvedValue([
      { landmark: "1" },
      { landmark: "2" },
      { landmark: "2" }, // дубль → должен схлопнуться
    ]);

    await expectRedirect(
      () => addLandmark(fd({ fromLetter: "E", number: "3" })),
      "/karta-sklada?edit=1&ok=landmark",
    );

    // Поиск существования — по нормализованной букве «Е» (кир).
    expect(wbFindUnique).toHaveBeenCalledWith({
      where: { letter: "Е" },
      select: { id: true },
    });
    // BatchLocation спрашивается по ОБЕИМ формам (in:[«Е», 'E']).
    expect(blFindMany).toHaveBeenCalledTimes(1);
    const where = blFindMany.mock.calls[0][0].where.block;
    expect(where.in).toEqual(expect.arrayContaining(["Е", "E"]));
    expect(where.in.length).toBe(2);
    // Создан WarehouseBlock с КИР «Е» + дедуп-ориентиры «1»,«2» (+ новый через addLandmark).
    expect(wbCreate).toHaveBeenCalledTimes(1);
    const created = wbCreate.mock.calls[0][0].data;
    expect(created.letter).toBe("Е");
    expect(created.landmarks.create.map((l: { number: string }) => l.number).sort()).toEqual(
      ["1", "2"],
    );
    // После материализации — сам addLandmark создаёт «3».
    expect(wlCreate).toHaveBeenCalledTimes(1);
    expect(wlCreate.mock.calls[0][0].data).toMatchObject({
      blockId: "wbNew",
      number: "3",
    });
  });

  it("materializeBlock: если WarehouseBlock уже есть (норм. форма) ⇒ create НЕ вызывается", async () => {
    wbFindUnique.mockResolvedValue({ id: "wbExisting" });

    await expectRedirect(
      () => setBlockMeta(fd({ fromLetter: "e", note: "у ворот" })),
      "/karta-sklada?edit=1&ok=meta",
    );

    expect(wbFindUnique).toHaveBeenCalledWith({
      where: { letter: "Е" }, // 'e' → «Е»
      select: { id: true },
    });
    expect(wbCreate).not.toHaveBeenCalled();
    expect(wbUpdate).toHaveBeenCalledWith({
      where: { id: "wbExisting" },
      data: { note: "у ворот", isFull: false, areaM2: null },
    });
  });
});

// ═══════════════ #16 · deleteBlock/blockHasStone проверяет обе формы ═══════════════

describe("deleteBlock — blockHasStone ищет и норм., и raw форму (ТЗ №7 #16)", () => {
  it("auto-блок «E» (лат.), а камень в BatchLocation записан под «Е» (кир.) ⇒ удаление БЛОКИРУЕТСЯ", async () => {
    // Обе формы проверяются: если хоть по одной >0 — камень есть → err=block_has_stone.
    blCount.mockResolvedValue(1);

    await expectRedirect(
      () => deleteBlock(fd({ fromLetter: "E" })),
      "/karta-sklada?edit=1&err=block_has_stone",
    );

    expect(blCount).toHaveBeenCalledTimes(1);
    const where = blCount.mock.calls[0][0].where.block;
    expect(where.in).toEqual(expect.arrayContaining(["E", "Е"]));
    expect(wbDelete).not.toHaveBeenCalled();
  });

  it("auto-блок без камня ни в одной форме ⇒ ok=deleted, WarehouseBlock.delete НЕ зовём (строки нет)", async () => {
    blCount.mockResolvedValue(0);

    await expectRedirect(
      () => deleteBlock(fd({ fromLetter: "E" })),
      "/karta-sklada?edit=1&ok=deleted",
    );

    expect(wbDelete).not.toHaveBeenCalled();
  });

  it("сетевой блок с камнем (по нормализованной букве) ⇒ err=block_has_stone", async () => {
    wbFindUnique.mockResolvedValue({ letter: "Е" });
    blCount.mockResolvedValue(1);

    await expectRedirect(
      () => deleteBlock(fd({ blockId: "wb1" })),
      "/karta-sklada?edit=1&err=block_has_stone",
    );

    expect(wbDelete).not.toHaveBeenCalled();
  });

  it("сетевой блок пуст ⇒ delete вызывается один раз", async () => {
    wbFindUnique.mockResolvedValue({ letter: "Ж" });
    blCount.mockResolvedValue(0);

    await expectRedirect(
      () => deleteBlock(fd({ blockId: "wb1" })),
      "/karta-sklada?edit=1&ok=deleted",
    );

    expect(wbDelete).toHaveBeenCalledWith({ where: { id: "wb1" } });
  });
});

// ═══════════════ ТЗ №7 #17 · materializeBlock race (двойной submit) ═══════════════

describe("materializeBlock — race через P2002 (ТЗ №7 #17)", () => {
  it("параллельные setBlockMeta на один авто-блок → БЕЗ 500, оба получают один id", async () => {
    const { Prisma } = await import("@prisma/client");

    // Оба вызова видят existing=null (мок отдаёт null дважды подряд).
    wbFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    // Первый create — успех (id=wbA); второй — P2002 (гонка).
    const conflict = new Prisma.PrismaClientKnownRequestError("dup letter", {
      code: "P2002",
      clientVersion: "n/a",
    });
    wbCreate
      .mockResolvedValueOnce({ id: "wbA" })
      .mockRejectedValueOnce(conflict);
    // Второй вызов, после P2002, перечитывает — уже видит победителя.
    wbFindUnique.mockResolvedValueOnce({ id: "wbA" });

    // Дальше — обычный поток setBlockMeta (update WarehouseBlock).
    // Первый вызов вернёт ok=meta.
    const p1 = expectRedirect(
      () => setBlockMeta(fd({ fromLetter: "К", note: "у ворот" })),
      "/karta-sklada?edit=1&ok=meta",
    );
    const p2 = expectRedirect(
      () => setBlockMeta(fd({ fromLetter: "К", note: "у ворот" })),
      "/karta-sklada?edit=1&ok=meta",
    );
    await Promise.all([p1, p2]);

    // create вызван РОВНО 2 раза — но только один WarehouseBlock есть в БД.
    expect(wbCreate).toHaveBeenCalledTimes(2);
    // Оба update указывают на ОДИН И ТОТ ЖЕ id (проигравший считал победителя).
    expect(wbUpdate).toHaveBeenCalledTimes(2);
    for (const call of wbUpdate.mock.calls) {
      expect(call[0].where).toEqual({ id: "wbA" });
    }
  });

  it("НЕ-P2002 ошибка (например, DB отвалилась) → throws (fail-fast, не глотаем)", async () => {
    wbFindUnique.mockResolvedValueOnce(null);
    wbCreate.mockRejectedValueOnce(new Error("db down"));

    await expect(
      setBlockMeta(fd({ fromLetter: "Л", note: "тест" })),
    ).rejects.toThrow(/db down/);
    // Update даже не пробовали.
    expect(wbUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════ ТЗ №7 #7 · addBlock / setBlockMeta — bounded decimal ═══════════════

describe("addBlock / setBlockMeta — переполнение площади ⇒ err=area (ТЗ №7 #7)", () => {
  it("addBlock: 99999999999 (> Decimal(12,3) max) ⇒ err=area, WarehouseBlock.create НЕ вызывается", async () => {
    await expectRedirect(
      () => addBlock(fd({ letter: "К", areaM2: "99999999999" })),
      "/karta-sklada?edit=1&err=area",
    );
    expect(wbCreate).not.toHaveBeenCalled();
  });

  it("addBlock: allowZero — «0» ⇒ создаётся с areaM2=0.000 (площадь блока может быть 0)", async () => {
    wbCreate.mockResolvedValueOnce({ id: "wbZero" });

    await expectRedirect(
      () => addBlock(fd({ letter: "Ф", areaM2: "0" })),
      "/karta-sklada?edit=1&ok=block",
    );
    expect(wbCreate).toHaveBeenCalledTimes(1);
    expect(wbCreate.mock.calls[0][0].data.areaM2).toBe("0.000");
  });

  it("setBlockMeta: текстовый ввод в площадь ⇒ err=area (bounded parser отклоняет 'abc')", async () => {
    await expectRedirect(
      () => setBlockMeta(fd({ blockId: "wb1", areaM2: "abc" })),
      "/karta-sklada?edit=1&err=area",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════ ТЗ №7 #18 · addBlock наследует ориентиры авто-блока ═══════════════

describe("addBlock — ориентиры унаследуются от авто-блока (ТЗ №7 #18)", () => {
  it("рука вводит букву «Д», у которой уже есть BatchLocation с ориентирами 1, 2, 2 → WarehouseBlock создаётся С этими ориентирами (дедупом)", async () => {
    // BatchLocation содержит «Д» с ориентирами 1, 2 и один дубль 2.
    blFindMany.mockResolvedValueOnce([
      { landmark: "1" },
      { landmark: "2" },
      { landmark: "2" },
    ]);
    wbCreate.mockResolvedValueOnce({ id: "wbD" });

    await expectRedirect(
      () => addBlock(fd({ letter: "Д", areaM2: "12,5" })),
      "/karta-sklada?edit=1&ok=block",
    );

    expect(wbCreate).toHaveBeenCalledTimes(1);
    const data = wbCreate.mock.calls[0][0].data;
    expect(data.letter).toBe("Д");
    // Ориентиры перенесены с дедупом (1, 2).
    expect(data.landmarks.create.map((l: { number: string }) => l.number).sort()).toEqual(
      ["1", "2"],
    );
    // BatchLocation.findMany вызван С поиском по обеим формам буквы (норм+raw
    // совпадают у «Д», но `in` контракт сохранён — регрессия ловится).
    expect(blFindMany).toHaveBeenCalledTimes(1);
    const where = blFindMany.mock.calls[0][0].where.block;
    expect(where.in).toContain("Д");
  });

  it("рука вводит НОВУЮ букву без BatchLocation → WarehouseBlock создаётся с ПУСТЫМИ ориентирами", async () => {
    blFindMany.mockResolvedValueOnce([]);
    wbCreate.mockResolvedValueOnce({ id: "wbFresh" });

    await expectRedirect(
      () => addBlock(fd({ letter: "Ю", areaM2: "" })),
      "/karta-sklada?edit=1&ok=block",
    );

    const data = wbCreate.mock.calls[0][0].data;
    expect(data.landmarks.create).toEqual([]);
  });
});
