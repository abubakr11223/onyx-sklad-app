// Bulk close PENDING photo requests on /fotozapros.
// Mocks: db, session, next/navigation.redirect (same pattern as karta-actions).
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => {
  const updateMany = vi.fn();
  const getCapabilities = vi.fn();
  return { updateMany, getCapabilities };
});

vi.mock("@/lib/db", () => ({
  db: {
    photoRequest: {
      updateMany: (...a: unknown[]) => M.updateMany(...a),
    },
  },
}));

vi.mock("@/lib/session", () => ({
  getCapabilities: () => M.getCapabilities(),
}));

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

import { bulkClosePhotoRequests } from "@/app/fotozapros/actions";
import {
  bulkCloseWhere,
  BULK_CLOSE_CONFIRM_TOKEN,
  BULK_CLOSE_DEFAULT_DAYS,
  parseBulkCloseForm,
} from "@/app/fotozapros/bulk-close";

function fd(pairs: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(pairs)) f.append(k, v);
  return f;
}

/** Valid bulk form: older scope, ack + confirm token. */
function bulkForm(
  overrides: Record<string, string> = {},
): FormData {
  return fd({
    confirm: BULK_CLOSE_CONFIRM_TOKEN,
    ack: "1",
    scope: "older",
    olderThanDays: String(BULK_CLOSE_DEFAULT_DAYS),
    ...overrides,
  });
}

async function expectRedirect(
  fn: () => Promise<void>,
  locContains: string | RegExp,
): Promise<string> {
  try {
    await fn();
    throw new Error("expected redirect");
  } catch (e) {
    expect(e).toMatchObject({ name: "NEXT_REDIRECT" });
    const loc = (e as NextRedirectError).location;
    if (typeof locContains === "string") {
      expect(loc).toContain(locContains);
    } else {
      expect(loc).toMatch(locContains);
    }
    return loc;
  }
}

beforeEach(() => {
  M.updateMany.mockReset();
  M.getCapabilities.mockReset();
  M.getCapabilities.mockResolvedValue({ canRequestPhoto: true });
  M.updateMany.mockResolvedValue({ count: 0 });
});

// ── Pure helpers ──

describe("bulkCloseWhere", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");

  it("all → only status PENDING (no createdAt filter)", () => {
    expect(bulkCloseWhere("all", 7, now)).toEqual({ status: "PENDING" });
  });

  it("older → PENDING + createdAt.lt cutoff (N days)", () => {
    const w = bulkCloseWhere("older", 7, now);
    expect(w.status).toBe("PENDING");
    expect(w.createdAt?.lt).toEqual(
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    );
  });

  it("older clamps days to ≥1", () => {
    const w = bulkCloseWhere("older", 0, now);
    expect(w.createdAt?.lt).toEqual(
      new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
    );
  });
});

describe("parseBulkCloseForm", () => {
  it("happy older + ack + confirm", () => {
    const r = parseBulkCloseForm(bulkForm());
    expect(r).toEqual({
      ok: true,
      scope: "older",
      olderThanDays: BULK_CLOSE_DEFAULT_DAYS,
    });
  });

  it("rejects missing confirm token", () => {
    const r = parseBulkCloseForm(bulkForm({ confirm: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Подтверждение/);
  });

  it("rejects missing ack checkbox", () => {
    const r = parseBulkCloseForm(
      fd({
        confirm: BULK_CLOSE_CONFIRM_TOKEN,
        scope: "all",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Понимаю/);
  });

  it("default scope is older when empty (safer)", () => {
    const r = parseBulkCloseForm(bulkForm({ scope: "" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scope).toBe("older");
  });

  it("scope=all accepted", () => {
    const r = parseBulkCloseForm(bulkForm({ scope: "all" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scope).toBe("all");
  });
});

// ── Server action ──

describe("bulkClosePhotoRequests", () => {
  it("WAREHOUSE (canRequestPhoto=false) → closeErr, no updateMany", async () => {
    M.getCapabilities.mockResolvedValue({ canRequestPhoto: false });
    M.updateMany.mockClear();
    const loc = await expectRedirect(
      () => bulkClosePhotoRequests(bulkForm()),
      "closeErr=",
    );
    expect(decodeURIComponent(loc)).toMatch(/Нет доступа|закрытие/i);
    expect(M.updateMany).not.toHaveBeenCalled();
  });

  it("manager: older scope → updateMany only PENDING + createdAt.lt, DONE+completedAt", async () => {
    M.updateMany.mockResolvedValue({ count: 5 });
    const loc = await expectRedirect(
      () => bulkClosePhotoRequests(bulkForm({ scope: "older" })),
      "closed=bulk",
    );
    expect(loc).toContain("n=5");
    expect(loc).toContain("scope=older");

    expect(M.updateMany).toHaveBeenCalledTimes(1);
    const arg = M.updateMany.mock.calls[0]![0] as {
      where: { status: string; createdAt?: { lt: Date } };
      data: { status: string; completedAt: Date };
    };
    expect(arg.where.status).toBe("PENDING");
    expect(arg.where.createdAt?.lt).toBeInstanceOf(Date);
    expect(arg.data.status).toBe("DONE");
    expect(arg.data.completedAt).toBeInstanceOf(Date);
  });

  it("manager: all → updateMany where only { status: PENDING } (DONE/CANCELLED untouched)", async () => {
    M.updateMany.mockResolvedValue({ count: 21 });
    const loc = await expectRedirect(
      () => bulkClosePhotoRequests(bulkForm({ scope: "all" })),
      "closed=bulk",
    );
    expect(loc).toContain("n=21");
    expect(loc).toContain("scope=all");

    const arg = M.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: { status: string };
    };
    expect(arg.where).toEqual({ status: "PENDING" });
    expect(arg.data.status).toBe("DONE");
  });

  it("redirect n= matches updateMany count (UI count contract)", async () => {
    M.updateMany.mockResolvedValue({ count: 3 });
    const loc = await expectRedirect(
      () => bulkClosePhotoRequests(bulkForm({ scope: "all" })),
      "n=3",
    );
    expect(loc).toMatch(/closed=bulk&n=3/);
  });

  it("missing ack → closeErr, no update", async () => {
    M.updateMany.mockClear();
    await expectRedirect(
      () =>
        bulkClosePhotoRequests(
          fd({
            confirm: BULK_CLOSE_CONFIRM_TOKEN,
            scope: "all",
          }),
        ),
      "closeErr=",
    );
    expect(M.updateMany).not.toHaveBeenCalled();
  });
});

describe("bulk close role matrix (server gate)", () => {
  it.each([
    { role: "WAREHOUSE", canRequestPhoto: false, allowed: false },
    { role: "PARTNER", canRequestPhoto: false, allowed: false },
    { role: "MANAGER", canRequestPhoto: true, allowed: true },
    { role: "OWNER", canRequestPhoto: true, allowed: true },
  ])(
    "$role canRequestPhoto=$canRequestPhoto → allowed=$allowed",
    async ({ canRequestPhoto, allowed }) => {
      M.getCapabilities.mockResolvedValue({ canRequestPhoto });
      M.updateMany.mockResolvedValue({ count: 1 });
      if (allowed) {
        await expectRedirect(
          () => bulkClosePhotoRequests(bulkForm({ scope: "all" })),
          "closed=bulk",
        );
        expect(M.updateMany).toHaveBeenCalled();
      } else {
        try {
          await bulkClosePhotoRequests(bulkForm());
          expect.fail("should redirect");
        } catch (e) {
          expect((e as NextRedirectError).location).toMatch(/closeErr=/);
        }
        expect(M.updateMany).not.toHaveBeenCalled();
      }
      M.updateMany.mockClear();
    },
  );
});
