// SK-1 — sof lokatsiya helperlari testlari (DB YO'Q).
// Normativ manba: TZ §5.7 «отметить/изменить локацию».
import { describe, expect, it } from "vitest";
import {
  buildMovePayload,
  isNoopMove,
  validateLocationEdit,
  validateNewLocation,
  validateQtyMove,
  validateSlabLocation,
  type NormalizedLocation,
} from "@/lib/locations";

describe("validateLocationEdit — §5.7", () => {
  it("validli kirish → ok, tримленные block/landmark, note", () => {
    const r = validateLocationEdit({
      block: "А",
      landmark: "2",
      note: "у ворот",
    });
    expect(r).toEqual({
      ok: true,
      // ТЗ №17 §3.1 — вход кир. «А», на выходе лат. «A» (единый алфавит).
      data: { block: "A", landmark: "2", note: "у ворот" },
    });
  });

  it("block/landmark вокруг обрезаются пробелами", () => {
    const r = validateLocationEdit({ block: "  Б  ", landmark: "  1–2 " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.block).toBe("Б");
      expect(r.data.landmark).toBe("1–2");
    }
  });

  it("пустой/пробельный block → «Укажите блок»", () => {
    expect(validateLocationEdit({ block: "", landmark: "2" })).toEqual({
      ok: false,
      error: "Укажите блок",
    });
    expect(validateLocationEdit({ block: "   ", landmark: "2" })).toEqual({
      ok: false,
      error: "Укажите блок",
    });
  });

  // ТЗ №18 §2 — ориентир стал НЕОБЯЗАТЕЛЬНЫМ: пусто = адрес до уровня блока.
  it("пустой/пробельный landmark → ok, landmark = «» (адрес до блока)", () => {
    // ТЗ №17 §3.1 — кир. «А» на входе → лат. «A» после нормализации.
    expect(validateLocationEdit({ block: "А", landmark: "" })).toEqual({
      ok: true,
      data: { block: "A", landmark: "", note: null },
    });
    expect(validateLocationEdit({ block: "А", landmark: "  " })).toEqual({
      ok: true,
      data: { block: "A", landmark: "", note: null },
    });
  });

  it("note: пустой/пробельный/отсутствует → null; заданный → тримится", () => {
    const empty = validateLocationEdit({ block: "А", landmark: "2", note: "" });
    expect(empty.ok && empty.data.note).toBe(null);

    const ws = validateLocationEdit({ block: "А", landmark: "2", note: "   " });
    expect(ws.ok && ws.data.note).toBe(null);

    const absent = validateLocationEdit({ block: "А", landmark: "2" });
    expect(absent.ok && absent.data.note).toBe(null);

    const nullish = validateLocationEdit({ block: "А", landmark: "2", note: null });
    expect(nullish.ok && nullish.data.note).toBe(null);

    const present = validateLocationEdit({ block: "А", landmark: "2", note: " рядом " });
    expect(present.ok && present.data.note).toBe("рядом");
  });
});

describe("buildMovePayload — delta from/to", () => {
  const base: NormalizedLocation = { block: "А", landmark: "2", note: null };

  it("полное изменение block+landmark → обе стороны с двумя полями", () => {
    const after: NormalizedLocation = { block: "Б", landmark: "3", note: null };
    expect(buildMovePayload(base, after)).toEqual({
      from: { block: "А", landmark: "2" },
      to: { block: "Б", landmark: "3" },
    });
  });

  it("изменился только block → в delta только block", () => {
    const after: NormalizedLocation = { block: "В", landmark: "2", note: null };
    expect(buildMovePayload(base, after)).toEqual({
      from: { block: "А" },
      to: { block: "В" },
    });
  });

  it("изменился только note (null → строка)", () => {
    const after: NormalizedLocation = { block: "А", landmark: "2", note: "у окна" };
    expect(buildMovePayload(base, after)).toEqual({
      from: { note: null },
      to: { note: "у окна" },
    });
  });

  it("ничего не изменилось → пустые from/to", () => {
    expect(buildMovePayload(base, { ...base })).toEqual({ from: {}, to: {} });
  });
});

describe("isNoopMove — no-op guard (нет аудита MOVE без правок)", () => {
  it("no-op: одинаковые before/after → true, дельта пуста", () => {
    const same: NormalizedLocation = { block: "А", landmark: "2", note: null };
    const payload = buildMovePayload(same, { ...same });
    expect(payload).toEqual({ from: {}, to: {} });
    expect(isNoopMove(payload)).toBe(true);
  });

  it("landmark-only «2»→«3» → не no-op, ожидаемая дельта", () => {
    const before: NormalizedLocation = { block: "А", landmark: "2", note: null };
    const after: NormalizedLocation = { block: "А", landmark: "3", note: null };
    const payload = buildMovePayload(before, after);
    expect(payload).toEqual({ from: { landmark: "2" }, to: { landmark: "3" } });
    expect(isNoopMove(payload)).toBe(false);
  });

  it("note «x»→null → не no-op, ожидаемая дельта", () => {
    const before: NormalizedLocation = { block: "А", landmark: "2", note: "x" };
    const after: NormalizedLocation = { block: "А", landmark: "2", note: null };
    const payload = buildMovePayload(before, after);
    expect(payload).toEqual({ from: { note: "x" }, to: { note: null } });
    expect(isNoopMove(payload)).toBe(false);
  });
});

// ─────────────────────── SK-1b (1): validateNewLocation ──────────────────────

describe("validateNewLocation — §5.7 добавление локации", () => {
  it("полный ввод: block/landmark + qty («12,5») + note → ok, нормализовано", () => {
    const r = validateNewLocation({
      block: "  А ",
      landmark: " 1–2 ",
      slabsHere: "40",
      areaHereM2: "12,5",
      note: "  у ворот ",
    });
    expect(r).toEqual({
      ok: true,
      data: {
        block: "A", // ТЗ №17 §3.1 — кир. «А» → лат. «A»
        landmark: "1–2",
        slabsHere: 40,
        areaHereM2: 12.5,
        note: "у ворот",
      },
    });
  });

  it("qty/note опциональны: пусто/absent → null", () => {
    const blanks = validateNewLocation({
      block: "Б",
      landmark: "3",
      slabsHere: "",
      areaHereM2: "  ",
      note: "",
    });
    expect(blanks).toEqual({
      ok: true,
      data: { block: "Б", landmark: "3", slabsHere: null, areaHereM2: null, note: null },
    });

    const absent = validateNewLocation({ block: "Б", landmark: "3" });
    expect(absent).toEqual({
      ok: true,
      data: { block: "Б", landmark: "3", slabsHere: null, areaHereM2: null, note: null },
    });
  });

  it("пустой block → «Укажите блок»; пустой landmark → ok (ТЗ №18 §2)", () => {
    expect(validateNewLocation({ block: "", landmark: "2" })).toEqual({
      ok: false,
      error: "Укажите блок",
    });
    expect(validateNewLocation({ block: "А", landmark: "  " })).toEqual({
      ok: true,
      data: {
        block: "A",
        landmark: "",
        slabsHere: null,
        areaHereM2: null,
        note: null,
      },
    });
  });

  it("неверное/отрицательное число плит → ошибка формата", () => {
    expect(
      validateNewLocation({ block: "А", landmark: "2", slabsHere: "-3" }),
    ).toEqual({ ok: false, error: "Число плит — целое положительное число" });
    expect(
      validateNewLocation({ block: "А", landmark: "2", slabsHere: "3,5" }),
    ).toEqual({ ok: false, error: "Число плит — целое положительное число" });
  });

  it("неверная площадь → ошибка формата площади", () => {
    expect(
      validateNewLocation({ block: "А", landmark: "2", areaHereM2: "abc" }),
    ).toEqual({ ok: false, error: "Площадь — положительное число, например 12,5" });
  });
});

// ──────────────────────── SK-1b (2): validateQtyMove ─────────────────────────

describe("validateQtyMove — перенос количества A→B", () => {
  const source = { slabsHere: 10, areaHereM2: 20 };

  it("плиты в пределах наличия → ok, area=null", () => {
    expect(validateQtyMove({ qtySlabs: "4" }, source)).toEqual({
      ok: true,
      data: { qtySlabs: 4, qtyAreaM2: null },
    });
  });

  it("площадь «12,5» в пределах наличия → ok", () => {
    expect(validateQtyMove({ qtyAreaM2: "12,5" }, source)).toEqual({
      ok: true,
      data: { qtySlabs: null, qtyAreaM2: 12.5 },
    });
  });

  it("оба поля разом → ok", () => {
    expect(validateQtyMove({ qtySlabs: "10", qtyAreaM2: "20" }, source)).toEqual({
      ok: true,
      data: { qtySlabs: 10, qtyAreaM2: 20 },
    });
  });

  it("ни одного количества → «Укажите количество для переноса»", () => {
    expect(validateQtyMove({ qtySlabs: "", qtyAreaM2: "" }, source)).toEqual({
      ok: false,
      error: "Укажите количество для переноса",
    });
    expect(validateQtyMove({}, source)).toEqual({
      ok: false,
      error: "Укажите количество для переноса",
    });
  });

  it("плит больше наличия → «Недостаточно плит в источнике»", () => {
    expect(validateQtyMove({ qtySlabs: "11" }, source)).toEqual({
      ok: false,
      error: "Недостаточно плит в источнике",
    });
  });

  it("slabsHere=null у источника, а плиты просят → недостаточно", () => {
    expect(
      validateQtyMove({ qtySlabs: "1" }, { slabsHere: null, areaHereM2: 20 }),
    ).toEqual({ ok: false, error: "Недостаточно плит в источнике" });
  });

  it("площади больше наличия → «Недостаточно площади в источнике»", () => {
    expect(validateQtyMove({ qtyAreaM2: "20,5" }, source)).toEqual({
      ok: false,
      error: "Недостаточно площади в источнике",
    });
  });

  it("неверный формат количества плит → ошибка формата", () => {
    expect(validateQtyMove({ qtySlabs: "3,5" }, source)).toEqual({
      ok: false,
      error: "Число плит — целое положительное число",
    });
  });

  it("ровно всё наличие (граница ≥) → ok", () => {
    expect(validateQtyMove({ qtySlabs: "10", qtyAreaM2: "20" }, source).ok).toBe(true);
  });
});

// ─────────────────────── SK-1b (3): validateSlabLocation ─────────────────────

describe("validateSlabLocation — локация плиты (без note)", () => {
  it("block/landmark тримятся → ok, только block/landmark", () => {
    expect(validateSlabLocation({ block: "  А ", landmark: " 2 " })).toEqual({
      ok: true,
      data: { block: "A", landmark: "2" }, // ТЗ №17 §3.1 — кир. → лат.
    });
  });

  it("пустой block → «Укажите блок»", () => {
    expect(validateSlabLocation({ block: "  ", landmark: "2" })).toEqual({
      ok: false,
      error: "Укажите блок",
    });
  });

  it("пустой landmark → ok: плита числится за блоком целиком (ТЗ №18 §2)", () => {
    expect(validateSlabLocation({ block: "А", landmark: "" })).toEqual({
      ok: true,
      data: { block: "A", landmark: "" },
    });
  });
});
