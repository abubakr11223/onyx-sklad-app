// Карта склада — server actions.
//   • ТЗ №7 #6  — renameBlock переносит камень (BatchLocation/Slab/Piece.block);
//   • ТЗ №7 #16 — materializeBlock/blockHasStone работают с нормализацией кода;
//   • ТЗ №7 #17 — race двойного submit'а на авто-блоке;
//   • ТЗ №7 #7/#18 — bounded-площадь и наследование ориентиров;
//   • ТЗ №17 §3.1 — единый алфавит теперь ЛАТИНИЦА (кир. коды нормализуются,
//     кириллица без двойника отвергается: err=letter_not_latin);
//   • ТЗ №17 §7  — защита от потери данных (камень в блоке/на ориентире) и
//     запись изменений карты в Историю.
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
  const slabCount = vi.fn();
  const slabUpdateMany = vi.fn();
  const pieceCount = vi.fn();
  const pieceUpdateMany = vi.fn();
  const wlDelete = vi.fn();
  const wlCreate = vi.fn();
  const wlFindUnique = vi.fn();
  const auditCreate = vi.fn();
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
    slab: { count: slabCount, updateMany: slabUpdateMany },
    piece: { count: pieceCount, updateMany: pieceUpdateMany },
    warehouseLandmark: {
      delete: wlDelete,
      create: wlCreate,
      findUnique: wlFindUnique,
    },
    auditLog: { create: auditCreate },
  };
  dbMock.$transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(dbMock);
  return {
    wbFindUnique, wbUpdate, wbCreate, wbAggregate, wbDelete,
    blCount, blFindMany, blUpdateMany,
    slabCount, slabUpdateMany, pieceCount, pieceUpdateMany,
    wlDelete, wlCreate, wlFindUnique, auditCreate, getRealSessionUser, dbMock,
  };
});
const {
  wbFindUnique, wbUpdate, wbCreate, wbAggregate, wbDelete,
  blCount, blFindMany, blUpdateMany,
  slabCount, slabUpdateMany, pieceCount, pieceUpdateMany,
  wlDelete, wlCreate, wlFindUnique, auditCreate, getRealSessionUser,
} = M;

vi.mock("@/lib/db", () => ({ db: M.dbMock }));
// ТЗ №7 #13 — requireOwner теперь в lib/session.ts; мокаем оба экспорта.
vi.mock("@/lib/session", () => ({
  getRealSessionUser: M.getRealSessionUser,
  // ТЗ №17 §6 — карту правит владелец ИЛИ зав. складом.
  requireWarehouseMapEditor: async (deniedRedirect: string) => {
    const me = await M.getRealSessionUser();
    if (!me || (me.role !== "OWNER" && me.role !== "WAREHOUSE_LEAD")) {
      const err = new Error("NEXT_REDIRECT") as Error & { location: string };
      err.name = "NEXT_REDIRECT";
      err.location = deniedRedirect;
      throw err;
    }
    return me.id as string;
  },
}));

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
  removeLandmark,
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

/**
 * ТЗ №18 §9.1 — renameBlock читает WarehouseBlock ДВАЖДЫ: текущий блок по id и
 * КОД НАЗНАЧЕНИЯ по letter (свободен ли он). Мок обязан различать эти запросы,
 * иначе блок «занимает» сам себя. takenLetters — коды, уже занятые сеткой.
 */
function mockCurrentBlock(letter: string, takenLetters: string[] = []): void {
  wbFindUnique.mockImplementation(
    async (args: { where: { id?: string; letter?: string } }) => {
      if (args.where.id) return { letter };
      if (args.where.letter && takenLetters.includes(args.where.letter)) {
        return { id: "wbTaken" };
      }
      return null;
    },
  );
}

/** payload.kind последней записи в Историю. */
function lastAuditKind(): string | undefined {
  const call = auditCreate.mock.calls.at(-1);
  return call?.[0]?.data?.payload?.kind;
}

beforeEach(() => {
  for (const m of [
    wbFindUnique, wbUpdate, wbCreate, wbAggregate, wbDelete,
    blCount, blFindMany, blUpdateMany,
    slabCount, slabUpdateMany, pieceCount, pieceUpdateMany,
    wlDelete, wlCreate, wlFindUnique, auditCreate, getRealSessionUser,
  ]) {
    m.mockReset();
  }
  getRealSessionUser.mockResolvedValue({ id: "owner1", role: "OWNER" });
  // Разумные значения по умолчанию.
  wbAggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
  blFindMany.mockResolvedValue([]);
  blUpdateMany.mockResolvedValue({ count: 0 });
  slabUpdateMany.mockResolvedValue({ count: 0 });
  pieceUpdateMany.mockResolvedValue({ count: 0 });
  blCount.mockResolvedValue(0);
  slabCount.mockResolvedValue(0);
  pieceCount.mockResolvedValue(0);
  auditCreate.mockResolvedValue({ id: "a1" });
  wbUpdate.mockResolvedValue({ letter: "A1" });
});

// ═══════════════ #6 · renameBlock переносит камень ═══════════════

describe("renameBlock — переносит BatchLocation/Slab/Piece.block (ТЗ №7 #6)", () => {
  it("переименование «A1»→«B2» ⇒ WarehouseBlock.letter + все *.block, одной транзакцией", async () => {
    mockCurrentBlock("A1");

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "B2" })),
      "/karta-sklada?edit=1&ok=renamed",
    );

    expect(wbUpdate).toHaveBeenCalledTimes(1);
    expect(wbUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: "wb1" },
      data: { letter: "B2" },
    });
    for (const m of [blUpdateMany, slabUpdateMany, pieceUpdateMany]) {
      expect(m).toHaveBeenCalledTimes(1);
      expect(m.mock.calls[0][0]).toEqual({
        where: { block: "A1" },
        data: { block: "B2" },
      });
    }
    // ТЗ №17 §7 — было → стало попадает в Историю.
    expect(lastAuditKind()).toBe("KARTA_BLOCK_RENAME");
    expect(auditCreate.mock.calls.at(-1)?.[0].data.payload).toMatchObject({
      from: "A1",
      to: "B2",
    });
  });

  it("ТЗ №17 §3.1 — кириллический ввод «В2» нормализуется в латинский «B2»", async () => {
    mockCurrentBlock("A1");

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "В2" })), // кир. «В»
      "/karta-sklada?edit=1&ok=renamed",
    );

    expect(wbUpdate.mock.calls[0][0].data.letter).toBe("B2"); // лат. «B»
  });

  it("ТЗ №17 §3.1 — кириллица без латинского двойника («Б») ⇒ err=letter_not_latin", async () => {
    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "Б" })),
      "/karta-sklada?edit=1&err=letter_not_latin",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
    expect(blUpdateMany).not.toHaveBeenCalled();
  });

  it("no-op: тот же код после нормализации ⇒ никаких update и записи в Историю", async () => {
    mockCurrentBlock("A1");

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "a1" })),
      "/karta-sklada?edit=1&ok=renamed",
    );

    expect(wbUpdate).not.toHaveBeenCalled();
    expect(blUpdateMany).not.toHaveBeenCalled();
    expect(slabUpdateMany).not.toHaveBeenCalled();
    expect(pieceUpdateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("новый код занят другим блоком (P2002) ⇒ err=block_taken", async () => {
    mockCurrentBlock("A1");
    const { Prisma } = await import("@prisma/client");
    wbUpdate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "n/a",
      }),
    );

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "B2" })),
      "/karta-sklada?edit=1&err=block_taken",
    );
  });

  // ── ТЗ №18 §9.1 — переименование в занятый код НЕ сливает блоки ──

  it("код назначения занят строкой сетки ⇒ err=block_taken, update не зовём", async () => {
    mockCurrentBlock("A1", ["B2"]);

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "B2" })),
      "/karta-sklada?edit=1&err=block_taken",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
    expect(blUpdateMany).not.toHaveBeenCalled();
  });

  it("код назначения занят ТОЛЬКО камнем (авто-блок) ⇒ err=block_taken, слияния нет", async () => {
    // Блок из приёмки строки WarehouseBlock не имеет — раньше переименование
    // проходило молча и сливало два блока: количество сходилось, а информация
    // о том, где лежал камень, исчезала без следа.
    mockCurrentBlock("A1");
    blCount.mockResolvedValue(3);

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "B2" })),
      "/karta-sklada?edit=1&err=block_taken",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
    expect(blUpdateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("код назначения занят плитой ⇒ err=block_taken", async () => {
    mockCurrentBlock("A1");
    slabCount.mockResolvedValue(1);

    await expectRedirect(
      () => renameBlock(fd({ blockId: "wb1", letter: "B2" })),
      "/karta-sklada?edit=1&err=block_taken",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
  });

  it("пустой новый код ⇒ err=letter, камень не трогается", async () => {
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
      () => renameBlock(fd({ blockId: "wb1", letter: "B2" })),
      "/karta-sklada?edit=1&err=denied",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
    expect(blUpdateMany).not.toHaveBeenCalled();
  });
});

// ═══════════════ #16 · materializeBlock + normalizeBlockLetter ═══════════════

describe("materializeBlock — нормализация кода (ТЗ №7 #16 + ТЗ №17 §3.1)", () => {
  it("addLandmark на auto-блок с кир. «Е» ⇒ WarehouseBlock создаётся под ЛАТ «E», ориентиры из обеих форм", async () => {
    wbFindUnique.mockResolvedValue(null);
    wbCreate.mockResolvedValue({ id: "wbNew" });
    blFindMany.mockResolvedValue([
      { landmark: "1" },
      { landmark: "2" },
      { landmark: "2" }, // дубль → должен схлопнуться
    ]);

    await expectRedirect(
      () => addLandmark(fd({ fromLetter: "Е", number: "3" })), // кир. «Е»
      "/karta-sklada?edit=1&ok=landmark",
    );

    expect(wbFindUnique).toHaveBeenCalledWith({
      where: { letter: "E" }, // лат.
      select: { id: true },
    });
    // BatchLocation спрашивается по ОБЕИМ формам (in:[«Е» кир, «E» лат]).
    expect(blFindMany).toHaveBeenCalledTimes(1);
    const where = blFindMany.mock.calls[0][0].where.block;
    expect(where.in).toEqual(expect.arrayContaining(["E", "Е"]));
    expect(where.in.length).toBe(2);
    expect(wbCreate).toHaveBeenCalledTimes(1);
    const created = wbCreate.mock.calls[0][0].data;
    expect(created.letter).toBe("E");
    expect(
      created.landmarks.create.map((l: { number: string }) => l.number).sort(),
    ).toEqual(["1", "2"]);
    expect(wlCreate).toHaveBeenCalledTimes(1);
    expect(wlCreate.mock.calls[0][0].data).toMatchObject({
      blockId: "wbNew",
      number: "3",
    });
    expect(lastAuditKind()).toBe("KARTA_LANDMARK_ADD");
  });

  it("materializeBlock: если WarehouseBlock уже есть (норм. форма) ⇒ create НЕ вызывается", async () => {
    wbFindUnique.mockResolvedValue({ id: "wbExisting" });

    await expectRedirect(
      () => setBlockMeta(fd({ fromLetter: "е", note: "у ворот" })),
      "/karta-sklada?edit=1&ok=meta",
    );

    expect(wbFindUnique).toHaveBeenCalledWith({
      where: { letter: "E" }, // кир. «е» → лат. «E»
      select: { id: true },
    });
    expect(wbCreate).not.toHaveBeenCalled();
    expect(wbUpdate).toHaveBeenCalledWith({
      where: { id: "wbExisting" },
      data: { note: "у ворот", isFull: false, areaM2: null },
      select: { letter: true },
    });
    expect(lastAuditKind()).toBe("KARTA_BLOCK_META");
  });
});

// ═══════ #16 + ТЗ №17 §7 · deleteBlock/blockHasStone ═══════

describe("deleteBlock — камень в блоке блокирует удаление", () => {
  it("auto-блок задан кир. «Е», а камень мог быть записан любой из форм ⇒ ищем обе, удаление БЛОКИРУЕТСЯ", async () => {
    blCount.mockResolvedValue(1);

    await expectRedirect(
      () => deleteBlock(fd({ fromLetter: "Е" })), // кир. «Е» → норм. лат. «E»
      "/karta-sklada?edit=1&err=block_has_stone",
    );

    const where = blCount.mock.calls[0][0].where.block;
    expect(where.in).toEqual(expect.arrayContaining(["E", "Е"]));
    expect(wbDelete).not.toHaveBeenCalled();
  });

  it("ТЗ №17 §7: партийных локаций нет, но лежит ПЛИТА ⇒ удаление БЛОКИРУЕТСЯ", async () => {
    wbFindUnique.mockResolvedValue({ letter: "A1" });
    blCount.mockResolvedValue(0);
    slabCount.mockResolvedValue(1);

    await expectRedirect(
      () => deleteBlock(fd({ blockId: "wb1" })),
      "/karta-sklada?edit=1&err=block_has_stone",
    );
    expect(wbDelete).not.toHaveBeenCalled();
  });

  it("ТЗ №17 §7: лежит КУСОК (Piece) ⇒ удаление БЛОКИРУЕТСЯ", async () => {
    wbFindUnique.mockResolvedValue({ letter: "A1" });
    pieceCount.mockResolvedValue(2);

    await expectRedirect(
      () => deleteBlock(fd({ blockId: "wb1" })),
      "/karta-sklada?edit=1&err=block_has_stone",
    );
    expect(wbDelete).not.toHaveBeenCalled();
  });

  it("auto-блок без камня ни в одной форме ⇒ ok=deleted, delete НЕ зовём (строки нет)", async () => {
    await expectRedirect(
      () => deleteBlock(fd({ fromLetter: "Е" })),
      "/karta-sklada?edit=1&ok=deleted",
    );
    expect(wbDelete).not.toHaveBeenCalled();
  });

  it("сетевой блок пуст ⇒ delete вызывается один раз + запись в Историю", async () => {
    wbFindUnique.mockResolvedValue({ letter: "G1" });

    await expectRedirect(
      () => deleteBlock(fd({ blockId: "wb1" })),
      "/karta-sklada?edit=1&ok=deleted",
    );

    expect(wbDelete).toHaveBeenCalledWith({ where: { id: "wb1" } });
    expect(lastAuditKind()).toBe("KARTA_BLOCK_DELETE");
  });
});

// ═══════════════ ТЗ №17 §7 · removeLandmark ═══════════════

describe("removeLandmark — ориентир с камнем не удаляется (ТЗ №17 §7)", () => {
  it("на ориентире стоит партия ⇒ err=landmark_has_stone, delete НЕ зовём", async () => {
    wlFindUnique.mockResolvedValue({
      number: "5",
      block: { id: "wb1", letter: "A1" },
    });
    blCount.mockResolvedValue(1);

    await expectRedirect(
      () => removeLandmark(fd({ landmarkId: "lm1" })),
      "/karta-sklada?edit=1&err=landmark_has_stone",
    );
    expect(wlDelete).not.toHaveBeenCalled();
    // Проверка адресная: ищем именно этот ориентир, а не весь блок.
    expect(blCount.mock.calls[0][0].where.landmark).toBe("5");
  });

  it("на ориентире лежит ПЛИТА ⇒ err=landmark_has_stone", async () => {
    wlFindUnique.mockResolvedValue({
      number: "5",
      block: { id: "wb1", letter: "A1" },
    });
    slabCount.mockResolvedValue(3);

    await expectRedirect(
      () => removeLandmark(fd({ landmarkId: "lm1" })),
      "/karta-sklada?edit=1&err=landmark_has_stone",
    );
    expect(wlDelete).not.toHaveBeenCalled();
  });

  it("пустой ориентир ⇒ удаляется + запись в Историю", async () => {
    wlFindUnique.mockResolvedValue({
      number: "5",
      block: { id: "wb1", letter: "A1" },
    });

    await expectRedirect(
      () => removeLandmark(fd({ landmarkId: "lm1" })),
      "/karta-sklada?edit=1&ok=landmark_removed",
    );
    expect(wlDelete).toHaveBeenCalledWith({ where: { id: "lm1" } });
    expect(lastAuditKind()).toBe("KARTA_LANDMARK_REMOVE");
  });

  it("несуществующий ориентир ⇒ err=notfound", async () => {
    wlFindUnique.mockResolvedValue(null);

    await expectRedirect(
      () => removeLandmark(fd({ landmarkId: "nope" })),
      "/karta-sklada?edit=1&err=notfound",
    );
    expect(wlDelete).not.toHaveBeenCalled();
  });

  it("обычный складчик ⇒ err=denied", async () => {
    getRealSessionUser.mockResolvedValue({ id: "u2", role: "WAREHOUSE" });

    await expectRedirect(
      () => removeLandmark(fd({ landmarkId: "lm1" })),
      "/karta-sklada?edit=1&err=denied",
    );
    expect(wlDelete).not.toHaveBeenCalled();
  });

  it("ТЗ №17 §6 — зав. складом (WAREHOUSE_LEAD) карту править МОЖЕТ", async () => {
    getRealSessionUser.mockResolvedValue({ id: "lead1", role: "WAREHOUSE_LEAD" });
    wlFindUnique.mockResolvedValue({
      number: "5",
      block: { id: "wb1", letter: "A1" },
    });

    await expectRedirect(
      () => removeLandmark(fd({ landmarkId: "lm1" })),
      "/karta-sklada?edit=1&ok=landmark_removed",
    );
    expect(wlDelete).toHaveBeenCalledWith({ where: { id: "lm1" } });
  });
});

// ═══════════════ ТЗ №7 #17 · materializeBlock race (двойной submit) ═══════════════

describe("materializeBlock — race через P2002 (ТЗ №7 #17)", () => {
  it("параллельные setBlockMeta на один авто-блок → БЕЗ 500, оба получают один id", async () => {
    const { Prisma } = await import("@prisma/client");

    wbFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const conflict = new Prisma.PrismaClientKnownRequestError("dup letter", {
      code: "P2002",
      clientVersion: "n/a",
    });
    wbCreate
      .mockResolvedValueOnce({ id: "wbA" })
      .mockRejectedValueOnce(conflict);
    wbFindUnique.mockResolvedValueOnce({ id: "wbA" });

    const p1 = expectRedirect(
      () => setBlockMeta(fd({ fromLetter: "K1", note: "у ворот" })),
      "/karta-sklada?edit=1&ok=meta",
    );
    const p2 = expectRedirect(
      () => setBlockMeta(fd({ fromLetter: "K1", note: "у ворот" })),
      "/karta-sklada?edit=1&ok=meta",
    );
    await Promise.all([p1, p2]);

    expect(wbCreate).toHaveBeenCalledTimes(2);
    expect(wbUpdate).toHaveBeenCalledTimes(2);
    for (const call of wbUpdate.mock.calls) {
      expect(call[0].where).toEqual({ id: "wbA" });
    }
  });

  it("НЕ-P2002 ошибка (например, DB отвалилась) → throws (fail-fast, не глотаем)", async () => {
    wbFindUnique.mockResolvedValueOnce(null);
    wbCreate.mockRejectedValueOnce(new Error("db down"));

    await expect(
      setBlockMeta(fd({ fromLetter: "L1", note: "тест" })),
    ).rejects.toThrow(/db down/);
    expect(wbUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════ ТЗ №7 #7 · addBlock / setBlockMeta — bounded decimal ═══════════════

describe("addBlock / setBlockMeta — переполнение площади ⇒ err=area (ТЗ №7 #7)", () => {
  it("addBlock: 99999999999 (> Decimal(12,3) max) ⇒ err=area, create НЕ вызывается", async () => {
    await expectRedirect(
      () => addBlock(fd({ letter: "K1", areaM2: "99999999999" })),
      "/karta-sklada?edit=1&err=area",
    );
    expect(wbCreate).not.toHaveBeenCalled();
  });

  it("addBlock: allowZero — «0» ⇒ создаётся с areaM2=0.000", async () => {
    wbCreate.mockResolvedValueOnce({ id: "wbZero" });

    await expectRedirect(
      () => addBlock(fd({ letter: "F1", areaM2: "0" })),
      "/karta-sklada?edit=1&ok=block",
    );
    expect(wbCreate).toHaveBeenCalledTimes(1);
    expect(wbCreate.mock.calls[0][0].data.areaM2).toBe("0.000");
    expect(lastAuditKind()).toBe("KARTA_BLOCK_ADD");
  });

  it("addBlock: кириллица без двойника («Ж») ⇒ err=letter_not_latin (ТЗ №17 §3.1)", async () => {
    await expectRedirect(
      () => addBlock(fd({ letter: "Ж1", areaM2: "" })),
      "/karta-sklada?edit=1&err=letter_not_latin",
    );
    expect(wbCreate).not.toHaveBeenCalled();
  });

  it("setBlockMeta: текстовый ввод в площадь ⇒ err=area", async () => {
    await expectRedirect(
      () => setBlockMeta(fd({ blockId: "wb1", areaM2: "abc" })),
      "/karta-sklada?edit=1&err=area",
    );
    expect(wbUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════ ТЗ №7 #18 · addBlock наследует ориентиры авто-блока ═══════════════

describe("addBlock — ориентиры наследуются от авто-блока (ТЗ №7 #18)", () => {
  it("код «D1» уже есть в BatchLocation с ориентирами 1, 2, 2 → блок создаётся С ними (дедупом)", async () => {
    blFindMany.mockResolvedValueOnce([
      { landmark: "1" },
      { landmark: "2" },
      { landmark: "2" },
    ]);
    wbCreate.mockResolvedValueOnce({ id: "wbD" });

    await expectRedirect(
      () => addBlock(fd({ letter: "D1", areaM2: "12,5" })),
      "/karta-sklada?edit=1&ok=block",
    );

    expect(wbCreate).toHaveBeenCalledTimes(1);
    const data = wbCreate.mock.calls[0][0].data;
    expect(data.letter).toBe("D1");
    expect(
      data.landmarks.create.map((l: { number: string }) => l.number).sort(),
    ).toEqual(["1", "2"]);
    expect(blFindMany).toHaveBeenCalledTimes(1);
    expect(blFindMany.mock.calls[0][0].where.block.in).toContain("D1");
  });

  it("новый код без BatchLocation → блок создаётся с ПУСТЫМИ ориентирами", async () => {
    blFindMany.mockResolvedValueOnce([]);
    wbCreate.mockResolvedValueOnce({ id: "wbFresh" });

    await expectRedirect(
      () => addBlock(fd({ letter: "S1", areaM2: "" })),
      "/karta-sklada?edit=1&ok=block",
    );

    expect(wbCreate.mock.calls[0][0].data.landmarks.create).toEqual([]);
  });
});
