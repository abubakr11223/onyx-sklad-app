// ТЗ №18 «Ориентир — необязательное поле» (22.08.2026).
//
// Что здесь проверяется:
//   §2 — партию можно принять в блок, не выбирая ориентир (блок обязателен);
//   §3 — формат адреса без ориентира: «Блок A1», без хвоста «· ориентир —»;
//   §5 — при ЕДИНСТВЕННОЙ локации «плит здесь»/«м² здесь» подставляются сами;
//   §6 — порядок блоков по коду, сортировка ЕСТЕСТВЕННАЯ (A2 раньше A10).
//
// Без БД: чистые функции. Часть с БД (проверка локации против сетки) — на моке
// prisma-клиента, как в остальных тестах проекта.

import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { warehouseBlock: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import { formatLocation, hasLandmark } from "@/lib/locations";
import { validateIntake, type IntakeInput } from "@/lib/validators/intake";
import { parsePieceRow } from "@/lib/breaking";
import { parseLocationRow } from "@/lib/batch-edit";
import {
  compareBlockCodes,
  findUnknownLocations,
  sortBlockOptions,
} from "@/lib/warehouse-grid";

function baseInput(overrides: Partial<IntakeInput> = {}): IntakeInput {
  return {
    stoneTypeId: "st_1",
    newStoneType: false,
    newName: "",
    newRockType: "",
    newColor: "",
    newDescription: "",
    newBasePrice: "",
    slabsTotal: "40",
    areaTotalM2: "220",
    lengthMm: "280",
    widthMm: "160",
    thicknessMm: "2",
    supplierNote: "",
    arrivedAt: "2026-07-03",
    locations: [{ block: "A1", landmark: "", slabsHere: "", areaHereM2: "" }],
    patternsEnabled: false,
    patterns: [],
    ...overrides,
  };
}

// ─────────────────────────── §3 · формат адреса ──────────────────────────────

describe("formatLocation — ТЗ №18 §3", () => {
  it("с ориентиром — как раньше", () => {
    expect(formatLocation("A1", "5")).toBe("Блок A1 · ориентир 5");
  });

  it("без ориентира — только блок, без хвоста и пустого разделителя", () => {
    expect(formatLocation("A1", "")).toBe("Блок A1");
    expect(formatLocation("A1", "   ")).toBe("Блок A1");
    expect(formatLocation("A1", null)).toBe("Блок A1");
    expect(formatLocation("A1")).toBe("Блок A1");
  });

  it("hasLandmark отличает «адрес до блока» от указанного ориентира", () => {
    expect(hasLandmark("")).toBe(false);
    expect(hasLandmark("  ")).toBe(false);
    expect(hasLandmark(null)).toBe(false);
    expect(hasLandmark("5")).toBe(true);
  });
});

// ──────────────────── §2 · приёмка в блок без ориентира ──────────────────────

describe("validateIntake — ориентир необязателен (ТЗ №18 §2)", () => {
  it("блок без ориентира: партия принимается, landmark = «»", () => {
    const r = validateIntake(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.locations).toEqual([
        { block: "A1", landmark: "", slabsHere: 40, areaHereM2: 220, patternIdx: null },
      ]);
    }
  });

  it("блок по-прежнему обязателен — ошибка адресуется в строку", () => {
    const r = validateIntake(
      baseInput({
        locations: [{ block: "", landmark: "", slabsHere: "", areaHereM2: "" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors["loc-0-block"]).toBeTruthy();
      expect(r.errors["loc-0-landmark"]).toBeUndefined();
    }
  });

  it("две локации в одном блоке: одна с ориентиром, вторая без — обе валидны", () => {
    const r = validateIntake(
      baseInput({
        locations: [
          { block: "A1", landmark: "5", slabsHere: "25", areaHereM2: "137,5" },
          { block: "A1", landmark: "", slabsHere: "15", areaHereM2: "82,5" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.locations.map((l) => l.landmark)).toEqual(["5", ""]);
    }
  });
});

// ──────────── §5 · «Плит здесь» / «м² здесь» при одной локации ───────────────

describe("ТЗ №18 §5 — единственная локация подставляет весь объём", () => {
  it("пустые «плит здесь» и «м² здесь» → итоги партии", () => {
    const r = validateIntake(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.locations[0].slabsHere).toBe(40);
      expect(r.data.locations[0].areaHereM2).toBe(220);
    }
  });

  it("введённое вручную значение не перетирается (и сверяется с итогом)", () => {
    const r = validateIntake(
      baseInput({
        locations: [{ block: "A1", landmark: "", slabsHere: "30", areaHereM2: "" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.locationsSum).toMatch(/30 из 40/);
  });

  it("две локации — распределение по-прежнему обязательно", () => {
    const r = validateIntake(
      baseInput({
        locations: [
          { block: "A1", landmark: "", slabsHere: "", areaHereM2: "" },
          { block: "A2", landmark: "", slabsHere: "", areaHereM2: "" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["loc-0-slabsHere"]).toBeTruthy();
  });
});

// ─────────────── §2 · разбить и правка партии — те же правила ────────────────

describe("разбить / правка партии — ориентир необязателен (ТЗ №18 §2)", () => {
  it("parsePieceRow: кусок без ориентира проходит", () => {
    const r = parsePieceRow({
      kind: "OFFCUT",
      sidesMm: "",
      boundingLengthMm: "120",
      boundingWidthMm: "60",
      thicknessMm: "2",
      areaM2: "0,72",
      block: "A1",
      landmark: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.landmark).toBe("");
  });

  it("parsePieceRow: без блока — по-прежнему ошибка", () => {
    const r = parsePieceRow({
      kind: "OFFCUT",
      sidesMm: "",
      boundingLengthMm: "120",
      boundingWidthMm: "60",
      thicknessMm: "2",
      areaM2: "0,72",
      block: "",
      landmark: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block).toBeTruthy();
  });

  it("parseLocationRow (правка партии): без ориентира — ok, без блока — отказ", () => {
    const ok = parseLocationRow({
      block: "A1",
      landmark: "",
      slabsHere: "",
      areaHereM2: "",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.landmark).toBe("");

    const bad = parseLocationRow({
      block: " ",
      landmark: "5",
      slabsHere: "",
      areaHereM2: "",
    });
    expect(bad.ok).toBe(false);
  });
});

// ────────────── §2 · серверная сверка со справочником локаций ────────────────

describe("findUnknownLocations — пустой ориентир законен (ТЗ №18 §2)", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([
      { letter: "A1", landmarks: [{ number: "1" }] },
      { letter: "D2", landmarks: [] },
    ]);
  });

  it("блок есть, ориентир не указан → локация известна", async () => {
    expect(await findUnknownLocations([{ block: "A1", landmark: "" }])).toEqual([]);
  });

  it("блок БЕЗ ориентиров в сетке → принять в него всё равно можно", async () => {
    expect(await findUnknownLocations([{ block: "D2", landmark: "" }])).toEqual([]);
  });

  it("блока нет в сетке → отказ остаётся", async () => {
    const res = await findUnknownLocations([{ block: "Z9", landmark: "" }]);
    expect(res).toEqual([{ index: 0, reason: "block", block: "Z9", landmark: "" }]);
  });

  it("указанный, но несуществующий ориентир → отказ остаётся", async () => {
    const res = await findUnknownLocations([{ block: "A1", landmark: "7" }]);
    expect(res).toEqual([
      { index: 0, reason: "landmark", block: "A1", landmark: "7" },
    ]);
  });
});

// ─────────────────────── §6 · порядок блоков по коду ─────────────────────────

describe("порядок блоков — ТЗ №18 §6", () => {
  it("ряды одного блока стоят рядом, F перед H, D1 перед D2", () => {
    const src = [
      "A", "B", "C", "D1", "G1", "G2", "H1", "H2", "F1", "F2", "S1", "S2",
      "K1", "K2", "K3", "A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3",
      "D2", "D3",
    ];
    expect([...src].sort(compareBlockCodes)).toEqual([
      "A", "A1", "A2", "A3", "B", "B1", "B2", "B3", "C", "C1", "C2", "C3",
      "D1", "D2", "D3", "F1", "F2", "G1", "G2", "H1", "H2", "K1", "K2", "K3",
      "S1", "S2",
    ]);
  });

  it("сортировка ЕСТЕСТВЕННАЯ: A2 раньше A10, а не после", () => {
    expect(["A10", "A2", "A1", "A11"].sort(compareBlockCodes)).toEqual([
      "A1", "A2", "A10", "A11",
    ]);
  });

  it("sortBlockOptions не мутирует исходный список", () => {
    const src = [{ letter: "B1" }, { letter: "A1" }];
    const out = sortBlockOptions(src);
    expect(out.map((b) => b.letter)).toEqual(["A1", "B1"]);
    expect(src.map((b) => b.letter)).toEqual(["B1", "A1"]);
  });
});
