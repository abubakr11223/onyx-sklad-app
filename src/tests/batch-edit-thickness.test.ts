// ТЗ №19 A3 — толщина обязательна и в ПРАВКЕ партии (ТЗ №14): старые партии
// без толщины нельзя сохранить, пока её не указали. Однородная партия —
// толщина партии; партия с узорами — толщина каждого узора.
// Сервер-экшен submitBatchEdit с замоканными session / applyBatchEdit (без БД).
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  applyBatchEdit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({
  getCapabilities: async () => ({
    canManageWarehouse: true,
    canEditBatchQuantity: true,
  }),
  currentActorId: async () => "u-owner",
}));
vi.mock("@/lib/batch-edit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/batch-edit")>();
  return { ...actual, applyBatchEdit: M.applyBatchEdit };
});
vi.mock("@/lib/warehouse-grid", () => ({
  findUnknownLocations: async () => [],
}));
vi.mock("@/lib/photo-blob", () => ({ putPhotoBlob: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { submitBatchEdit } from "@/app/priemka/edit-actions";
import { THICKNESS_REQUIRED_MSG } from "@/lib/validators/intake";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  }
  return fd;
}

const base = {
  batchId: "b1",
  expectedSlabsTotal: "10",
  expectedAreaTotalM2: "50",
  expectedSlabsSoldDirect: "0",
  expectedAreaSoldDirectM2: "0",
  expectedLengthMm: "280",
  expectedWidthMm: "160",
  expectedThicknessMm: "",
  expectedSupplierNote: "",
  expectedArrivedAt: "2026-09-09",
  slabsTotal: "10",
  areaTotalM2: "50",
  lengthMm: "280",
  widthMm: "160",
  arrivedAt: "2026-09-09",
  supplierNote: "",
  locBlock: "A1",
  locLandmark: "",
  locSlabs: "10",
  locArea: "",
  locId: "",
  locPattern: "",
};

const pattern = (thickness: string) => ({
  patId: "p1",
  patDesc: "светлый",
  patThickness: thickness,
  patLength: "280",
  patWidth: "160",
  patSlabs: "10",
  patArea: "50",
});

beforeEach(() => {
  M.applyBatchEdit.mockReset();
  M.applyBatchEdit.mockResolvedValue({ batchId: "b1", changes: [] });
});

describe("submitBatchEdit — ТЗ №19 A3 толщина обязательна", () => {
  it("однородная партия без толщины → ошибка thicknessMm, правка не применяется", async () => {
    const r = await submitBatchEdit(
      { errors: {} },
      form({ ...base, thicknessMm: "" }),
    );
    expect(r.errors.thicknessMm).toBe(THICKNESS_REQUIRED_MSG);
    expect(M.applyBatchEdit).not.toHaveBeenCalled();
  });

  it("однородная партия с толщиной → сохраняется", async () => {
    await expect(
      submitBatchEdit({ errors: {} }, form({ ...base, thicknessMm: "2" })),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(M.applyBatchEdit).toHaveBeenCalledTimes(1);
    expect(M.applyBatchEdit.mock.calls[0][0].thicknessMm).toBe(2);
  });

  it("узор без толщины → ошибка pat-0-th", async () => {
    const r = await submitBatchEdit(
      { errors: {} },
      form({ ...base, thicknessMm: "", ...pattern("") }),
    );
    expect(r.errors["pat-0-th"]).toBe(THICKNESS_REQUIRED_MSG);
    // Толщина партии с узорами не требуется — она в узорах.
    expect(r.errors.thicknessMm).toBeUndefined();
    expect(M.applyBatchEdit).not.toHaveBeenCalled();
  });

  it("узор с толщиной, партия без → сохраняется", async () => {
    await expect(
      submitBatchEdit(
        { errors: {} },
        form({ ...base, thicknessMm: "", ...pattern("1,8") }),
      ),
    ).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(M.applyBatchEdit.mock.calls[0][0].patterns[0].thicknessMm).toBe(1.8);
  });
});
