// Part 2 — karta: getKartaState default-merge mantiqi + cellId validatsiya.
// db moklashtiriladi (findMany), real DB YO'Q.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { kartaCell: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import { DEFAULT_DONE, getKartaState, isValidCellId } from "@/lib/karta";

beforeEach(() => {
  findMany.mockReset();
});

describe("getKartaState — default-merge", () => {
  it("DB bo'sh → faqat DEFAULT_DONE'lar true", async () => {
    findMany.mockResolvedValue([]);
    const state = await getKartaState();
    for (const id of DEFAULT_DONE) expect(state[id]).toBe(true);
    expect(Object.keys(state).sort()).toEqual([...DEFAULT_DONE].sort());
  });

  it("DB yozuvi defaultni bekor qiladi (true → false)", async () => {
    findMany.mockResolvedValue([{ cellId: "1.1", done: false }]);
    const state = await getKartaState();
    expect(state["1.1"]).toBe(false); // default true edi, DB o'chirdi
    expect(state["1.3"]).toBe(true); // tegilmagan default — hali true
  });

  it("default bo'lmagan katak DB'da true bo'lsa → qo'shiladi", async () => {
    findMany.mockResolvedValue([{ cellId: "2А", done: true }]);
    const state = await getKartaState();
    expect(state["2А"]).toBe(true);
    expect(state["1.1"]).toBe(true); // defaultlar saqlanadi
  });
});

describe("isValidCellId", () => {
  it("yaroqli id'lar", () => {
    expect(isValidCellId("1.1")).toBe(true);
    expect(isValidCellId("4.1")).toBe(true);
    expect(isValidCellId("2А")).toBe(true); // kirill harfi
    expect(isValidCellId("3Г")).toBe(true);
  });

  it("yaroqsiz id'lar", () => {
    expect(isValidCellId("")).toBe(false);
    expect(isValidCellId("a".repeat(9))).toBe(false); // uzun
    expect(isValidCellId("<script>")).toBe(false);
    expect(isValidCellId("1;drop")).toBe(false);
  });
});
