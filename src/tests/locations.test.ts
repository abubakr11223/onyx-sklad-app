// SK-1 — sof lokatsiya helperlari testlari (DB YO'Q).
// Normativ manba: TZ §5.7 «отметить/изменить локацию».
import { describe, expect, it } from "vitest";
import {
  buildMovePayload,
  isNoopMove,
  validateLocationEdit,
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
      data: { block: "А", landmark: "2", note: "у ворот" },
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

  it("пустой/пробельный landmark → «Укажите ориентир»", () => {
    expect(validateLocationEdit({ block: "А", landmark: "" })).toEqual({
      ok: false,
      error: "Укажите ориентир",
    });
    expect(validateLocationEdit({ block: "А", landmark: "  " })).toEqual({
      ok: false,
      error: "Укажите ориентир",
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
