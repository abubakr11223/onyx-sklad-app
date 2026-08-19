// ТЗ №17 §6 — сетка склада: сортировка ориентиров и серверная проверка
// «локация есть в справочнике». Чистая часть — без БД; часть с БД — на моке
// prisma-клиента (как в остальных тестах проекта).
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { warehouseBlock: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import {
  findUnknownLocations,
  sortLandmarks,
  validateLocationsAgainstGrid,
} from "@/lib/warehouse-grid";

describe("sortLandmarks", () => {
  it("сортирует по числу, а не по строке («10» после «9»)", () => {
    expect(sortLandmarks(["10", "2", "1", "9"])).toEqual(["1", "2", "9", "10"]);
  });

  it("диапазоны идут по первому числу («1–2» перед «3»)", () => {
    expect(sortLandmarks(["3", "1–2"])).toEqual(["1–2", "3"]);
  });

  it("нечисловые уходят в конец, между собой — по алфавиту", () => {
    expect(sortLandmarks(["у входа", "2", "дальний"])).toEqual([
      "2",
      "дальний",
      "у входа",
    ]);
  });

  it("не мутирует исходный массив", () => {
    const src = ["3", "1"];
    sortLandmarks(src);
    expect(src).toEqual(["3", "1"]);
  });
});

describe("findUnknownLocations — ТЗ №17 §6", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([
      { letter: "A1", landmarks: [{ number: "1" }, { number: "2" }] },
      { letter: "D2", landmarks: [{ number: "5" }] },
    ]);
  });

  it("известная пара блок+ориентир проходит", async () => {
    const res = await findUnknownLocations([{ block: "A1", landmark: "2" }]);
    expect(res).toEqual([]);
  });

  it("несуществующий блок — reason «block»", async () => {
    const res = await findUnknownLocations([{ block: "Z9", landmark: "1" }]);
    expect(res).toEqual([
      { index: 0, reason: "block", block: "Z9", landmark: "1" },
    ]);
  });

  it("блок есть, ориентира нет — reason «landmark»", async () => {
    const res = await findUnknownLocations([{ block: "A1", landmark: "7" }]);
    expect(res[0]).toMatchObject({ index: 0, reason: "landmark", block: "A1" });
  });

  it("ввод нормализуется: кир. «А1» находит латинский блок «A1»", async () => {
    const res = await findUnknownLocations([{ block: "а1", landmark: "1" }]);
    expect(res).toEqual([]);
  });

  it("индекс ошибки указывает на нужную строку формы", async () => {
    const res = await findUnknownLocations([
      { block: "A1", landmark: "1" },
      { block: "QQ", landmark: "1" },
    ]);
    expect(res).toHaveLength(1);
    expect(res[0].index).toBe(1);
  });

  it("пустой список локаций не ходит в БД", async () => {
    await findUnknownLocations([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("validateLocationsAgainstGrid — ключи ошибок формы", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([
      { letter: "A1", landmarks: [{ number: "1" }] },
    ]);
  });

  it("всё известно — ошибок нет", async () => {
    expect(await validateLocationsAgainstGrid([{ block: "A1", landmark: "1" }]))
      .toEqual({});
  });

  it("ошибка блока ложится в ключ loc-{i}-block", async () => {
    const errors = await validateLocationsAgainstGrid([
      { block: "A1", landmark: "1" },
      { block: "XX", landmark: "1" },
    ]);
    expect(Object.keys(errors)).toEqual(["loc-1-block"]);
    expect(errors["loc-1-block"]).toContain("карте склада");
  });

  it("ошибка ориентира ложится в ключ loc-{i}-landmark", async () => {
    const errors = await validateLocationsAgainstGrid([
      { block: "A1", landmark: "99" },
    ]);
    expect(Object.keys(errors)).toEqual(["loc-0-landmark"]);
  });
});
