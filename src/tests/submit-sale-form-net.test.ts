// round2: submitSale always sets errors.form when any field error exists
// (second net against silent step-4).
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCapabilities = vi.fn();
const currentActorId = vi.fn();

vi.mock("@/lib/session", () => ({
  getCapabilities: (...a: unknown[]) => getCapabilities(...a),
  currentActorId: (...a: unknown[]) => currentActorId(...a),
}));

vi.mock("@/lib/db", () => ({
  db: {
    client: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    saleRecord: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/sales", () => ({
  sellUnit: vi.fn(),
  sellBatchVolume: vi.fn(),
  sellPatternVolume: vi.fn(),
  sellWholeBatch: vi.fn(),
  returnSale: vi.fn(),
  confirmReturnedUnit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    (err as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
    throw err;
  }),
}));

import { submitSale } from "@/app/prodazha/actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const prev = { errors: {}, conflict: null };

beforeEach(() => {
  getCapabilities.mockReset();
  currentActorId.mockReset();
  getCapabilities.mockResolvedValue({
    canSell: true,
    canSeeAllClients: true,
    canSeeHistory: true,
  });
  currentActorId.mockResolvedValue("mgr1");
});

describe("submitSale — form-level second net (round2 silent-forms)", () => {
  it("missing clientId → errors.clientId AND errors.form", async () => {
    const res = await submitSale(
      prev,
      fd({
        mode: "SLAB",
        unitId: "slab1",
        clientId: "",
        paymentMethod: "CASH",
        currency: "USD",
        price: "100",
      }),
    );
    expect(res.conflict).toBeNull();
    expect(res.errors.clientId).toBeTruthy();
    expect(res.errors.form).toBeTruthy();
    // form mirrors a field message so step-4 form-only banners also work
    expect(res.errors.form).toMatch(/клиент/i);
  });

  it("volume qty error → errors.form set alongside qty*", async () => {
    const res = await submitSale(
      prev,
      fd({
        mode: "BATCH_VOLUME",
        batchId: "b1",
        clientId: "c1",
        siteMode: "none",
        paymentMethod: "CASH",
        currency: "USD",
        price: "100",
        qtySlabs: "",
        qtyAreaM2: "",
      }),
    );
    expect(res.conflict).toBeNull();
    expect(
      res.errors.qty || res.errors.qtySlabs || res.errors.qtyAreaM2,
    ).toBeTruthy();
    expect(res.errors.form).toBeTruthy();
  });
});
