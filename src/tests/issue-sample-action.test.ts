// TZ14 BUG-01 — issueSampleAction contract (prodazha → Sample ACTIVE).
// Domain issueSample is mocked: this file fails if the ACTION swallows errors
// or omits errors.form (silent step-4), or maps PATTERN_VOLUME wrong.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.fn();
const currentActorId = vi.fn();
const issueSample = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
  throw err;
});
const batchPatternFindUnique = vi.fn();

vi.mock("@/lib/session", () => ({
  getCapabilities: (...a: unknown[]) => getCapabilities(...a),
  currentActorId: (...a: unknown[]) => currentActorId(...a),
}));

vi.mock("@/lib/samples", () => ({
  issueSample: (...a: unknown[]) => issueSample(...a),
  returnSample: vi.fn(),
  extendSampleDueDate: vi.fn(),
  sellSample: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...(a as [string])),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

vi.mock("@/lib/db", () => ({
  db: {
    batchPattern: {
      findUnique: (...a: unknown[]) => batchPatternFindUnique(...a),
    },
  },
}));

import { issueSampleAction } from "@/app/obraztsy/actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const prev = { errors: {}, conflict: null };

beforeEach(() => {
  getCapabilities.mockReset();
  currentActorId.mockReset();
  issueSample.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
  batchPatternFindUnique.mockReset();
  getCapabilities.mockResolvedValue({
    canSell: true,
    canSeeAllClients: true,
    canSeeHistory: true,
  });
  currentActorId.mockResolvedValue("mgr1");
  issueSample.mockResolvedValue({ ok: true, sampleId: "samp-new" });
});

describe("issueSampleAction — silent-error regressions (TZ14 BUG-01)", () => {
  it("missing clientId → errors.clientId AND errors.form (never field-only silence)", async () => {
    const state = await issueSampleAction(
      prev,
      fd({
        mode: "SLAB",
        unitId: "slab1",
        clientId: "",
        returnDueDate: "2026-09-01",
      }),
    );
    expect(issueSample).not.toHaveBeenCalled();
    expect(state.conflict).toBeNull();
    expect(state.errors.clientId).toMatch(/клиент/i);
    // THE fix: form must be set so SaleForm step-4 banner shows without field widget
    expect(state.errors.form).toBeTruthy();
    expect(state.errors.form).toMatch(/клиент/i);
  });

  it("missing returnDueDate → errors.returnDueDate AND errors.form", async () => {
    const state = await issueSampleAction(
      prev,
      fd({
        mode: "SLAB",
        unitId: "slab1",
        clientId: "c1",
        returnDueDate: "",
      }),
    );
    expect(issueSample).not.toHaveBeenCalled();
    expect(state.errors.returnDueDate).toMatch(/срок|возврат/i);
    expect(state.errors.form).toBeTruthy();
  });

  it("BATCH_VOLUME without qty → errors.qty + form (volume gate)", async () => {
    const state = await issueSampleAction(
      prev,
      fd({
        mode: "BATCH_VOLUME",
        batchId: "b1",
        clientId: "c1",
        returnDueDate: "2026-09-01",
      }),
    );
    expect(issueSample).not.toHaveBeenCalled();
    expect(state.errors.qty || state.errors.form).toMatch(/объём|плит|м²/i);
    expect(state.errors.form).toBeTruthy();
  });

  it("WHOLE_BATCH → clear form error (not silent, not fake batch qty)", async () => {
    const state = await issueSampleAction(
      prev,
      fd({
        mode: "WHOLE_BATCH",
        batchId: "b1",
        clientId: "c1",
        returnDueDate: "2026-09-01",
      }),
    );
    expect(issueSample).not.toHaveBeenCalled();
    expect(state.errors.form).toMatch(/объём|парти/i);
  });

  it("PATTERN_VOLUME resolves batchPatternId → batchId before issueSample", async () => {
    batchPatternFindUnique.mockResolvedValue({ batchId: "batch-real" });
    await expect(
      issueSampleAction(
        prev,
        fd({
          mode: "PATTERN_VOLUME",
          batchPatternId: "pat1",
          qtySlabs: "2",
          clientId: "c1",
          returnDueDate: "2026-09-01",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(batchPatternFindUnique).toHaveBeenCalledWith({
      where: { id: "pat1" },
      select: { batchId: true },
    });
    expect(issueSample).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "BATCH_VOLUME",
        batchId: "batch-real",
        qtySlabs: 2,
        clientId: "c1",
        managerId: "mgr1",
      }),
    );
  });

  it("happy SLAB → issueSample + redirect /obraztsy?ok=issued", async () => {
    await expect(
      issueSampleAction(
        prev,
        fd({
          mode: "SLAB",
          unitId: "slab1",
          clientId: "c1",
          returnDueDate: "2026-09-01",
          sampleComment: "витрина",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT:\/obraztsy\?ok=issued&id=samp-new/);
    expect(issueSample).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "SLAB",
        unitId: "slab1",
        clientId: "c1",
        managerId: "mgr1",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/obraztsy");
  });

  it("domain ALREADY_ISSUED → conflict (not empty state)", async () => {
    issueSample.mockResolvedValue({
      ok: false,
      error: { code: "ALREADY_ISSUED", message: "Уже выдан" },
    });
    const state = await issueSampleAction(
      prev,
      fd({
        mode: "SLAB",
        unitId: "slab1",
        clientId: "c1",
        returnDueDate: "2026-09-01",
      }),
    );
    expect(state.conflict).toBe("Уже выдан");
    expect(state.errors).toEqual({});
  });

  it("domain INVALID_INPUT → errors.form", async () => {
    issueSample.mockResolvedValue({
      ok: false,
      error: { code: "INVALID_INPUT", message: "Не выбран камень" },
    });
    const state = await issueSampleAction(
      prev,
      fd({
        mode: "SLAB",
        unitId: "slab1",
        clientId: "c1",
        returnDueDate: "2026-09-01",
      }),
    );
    expect(state.errors.form).toBe("Не выбран камень");
    expect(state.conflict).toBeNull();
  });

  it("canSell false → form error, no domain call", async () => {
    getCapabilities.mockResolvedValue({ canSell: false });
    const state = await issueSampleAction(
      prev,
      fd({ mode: "SLAB", unitId: "x", clientId: "c", returnDueDate: "2026-09-01" }),
    );
    expect(issueSample).not.toHaveBeenCalled();
    expect(state.errors.form).toMatch(/доступ/i);
  });
});
