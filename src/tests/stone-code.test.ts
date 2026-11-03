// ТЗ №20 G — код ONX-…: нормализация ввода, поиск по 5 таблицам, where для «Поиска».
import { describe, expect, it, vi } from "vitest";
import {
  STONE_CODE_ALPHABET,
  findByCode,
  formatFreeQty,
  normalizeStoneCode,
  staffCardHref,
  type StoneCodeDb,
} from "@/lib/stone-code";
import { codeWhere, materialWhere } from "@/lib/poisk-search";

describe("normalizeStoneCode", () => {
  it.each([
    ["ONX-7K3QD", "ONX-7K3QD"],
    ["onx-7k3qd", "ONX-7K3QD"],
    ["  ONX 7K3QD ", "ONX-7K3QD"],
    ["ONX7K3QD", "ONX-7K3QD"],
    ["7k3qd", "ONX-7K3QD"],
    ["https://onyx-sklad-app.vercel.app/k/ONX-7K3QD", "ONX-7K3QD"],
    ["https://x.test/k/onx-7k3qd?utm=1", "ONX-7K3QD"],
  ])("%s → %s", (raw, out) => {
    expect(normalizeStoneCode(raw)).toBe(out);
  });

  it.each(["", "ONX-", "ONX-7K3Q", "ONX-7K3QDX", "ONX-0K3QD", "ONX-IK3QD", "травертин", "ONX-7K3Q!"])(
    "не код: %s",
    (raw) => {
      expect(normalizeStoneCode(raw)).toBeNull();
    },
  );

  it("requirePrefix: голые 5 символов не считаются кодом", () => {
    expect(normalizeStoneCode("CREMA", { requirePrefix: true })).toBeNull();
    expect(normalizeStoneCode("onx-crema", { requirePrefix: true })).toBe("ONX-CREMA");
  });

  it("алфавит — 32 символа без 0/O/1/I", () => {
    expect(STONE_CODE_ALPHABET).toHaveLength(32);
    expect(STONE_CODE_ALPHABET).not.toMatch(/[01OI]/);
  });
});

function fakeDb(found: Partial<Record<keyof StoneCodeDb, unknown>>) {
  const mk = (k: keyof StoneCodeDb) => ({
    findUnique: vi.fn().mockResolvedValue(found[k] ?? null),
  });
  return {
    stoneType: mk("stoneType"),
    batch: mk("batch"),
    batchPattern: mk("batchPattern"),
    slab: mk("slab"),
    piece: mk("piece"),
  };
}

describe("findByCode", () => {
  it("неверный ввод — БД не трогаем", async () => {
    const db = fakeDb({});
    expect(await findByCode(db as unknown as StoneCodeDb, "abc")).toBeNull();
    expect(db.stoneType.findUnique).not.toHaveBeenCalled();
  });

  it("ищет нормализованный код во всех пяти таблицах", async () => {
    const db = fakeDb({});
    expect(await findByCode(db as unknown as StoneCodeDb, "onx 7k3qd")).toBeNull();
    for (const t of Object.values(db)) {
      expect(t.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: "ONX-7K3QD" } }),
      );
    }
  });

  it("вид камня", async () => {
    const db = fakeDb({ stoneType: { id: "st1" } });
    const hit = await findByCode(db as unknown as StoneCodeDb, "ONX-AAAAA");
    expect(hit).toEqual({
      kind: "STONE_TYPE",
      code: "ONX-AAAAA",
      stoneTypeId: "st1",
      ids: { stoneTypeId: "st1", batchId: null, batchPatternId: null, slabId: null, pieceId: null },
    });
    expect(staffCardHref(hit!)).toBe("/kamen/st1");
  });

  it("узор → вид через партию", async () => {
    const db = fakeDb({ batchPattern: { id: "p1", batchId: "b1", batch: { stoneTypeId: "st2" } } });
    const hit = await findByCode(db as unknown as StoneCodeDb, "ONX-BBBBB");
    expect(hit?.kind).toBe("PATTERN");
    expect(hit?.stoneTypeId).toBe("st2");
    expect(hit?.ids).toMatchObject({ batchId: "b1", batchPatternId: "p1" });
  });

  it("плита и бой", async () => {
    const slab = await findByCode(
      fakeDb({ slab: { id: "s1", batchId: "b1", batchPatternId: null, stoneTypeId: "st3" } }) as unknown as StoneCodeDb,
      "ONX-CCCCC",
    );
    expect(slab?.kind).toBe("SLAB");
    expect(slab?.ids.slabId).toBe("s1");
    const piece = await findByCode(
      fakeDb({ piece: { id: "pc1", batchId: null, batchPatternId: null, stoneTypeId: "st4" } }) as unknown as StoneCodeDb,
      "ONX-DDDDD",
    );
    expect(piece?.kind).toBe("PIECE");
    expect(piece?.ids.pieceId).toBe("pc1");
  });
});

describe("Поиск по коду (materialWhere / codeWhere)", () => {
  it("обычный текст — без условий по коду", () => {
    expect(codeWhere("травертин")).toEqual([]);
    expect(materialWhere("травертин")?.OR).toHaveLength(3);
  });

  it("код — точное совпадение у вида и всех его единиц", () => {
    const w = codeWhere("onx-7k3qd");
    expect(w).toContainEqual({ code: "ONX-7K3QD" });
    expect(w).toContainEqual({ slabs: { some: { code: "ONX-7K3QD" } } });
    expect(w).toContainEqual({ pieces: { some: { code: "ONX-7K3QD" } } });
    expect(JSON.stringify(w)).toContain("patterns");
    expect(materialWhere("ONX-7K3QD")?.OR).toHaveLength(7);
  });
});

describe("formatFreeQty", () => {
  it("плиты и м²", () => {
    expect(formatFreeQty(3, 13.44)).toBe("свободно 3 пл. / 13,4 м²");
  });
  it("ноль — нет в наличии", () => {
    expect(formatFreeQty(0, 0)).toBe("нет в наличии");
    expect(formatFreeQty(null, null)).toBe("нет в наличии");
  });
});
