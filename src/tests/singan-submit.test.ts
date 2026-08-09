// round2: submitSingan must not report plain success when Photo write fails.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeShapeDraft } from "@/lib/singan";

const getCapabilities = vi.fn();
const currentActorId = vi.fn();
const registerDirectPiece = vi.fn();
const batchFindUnique = vi.fn();
const photoCreate = vi.fn();
const redirect = vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
  throw err;
});

vi.mock("@/lib/session", () => ({
  getCapabilities: (...a: unknown[]) => getCapabilities(...a),
  currentActorId: (...a: unknown[]) => currentActorId(...a),
}));

vi.mock("@/lib/db", () => ({
  db: {
    batch: {
      findUnique: (...a: unknown[]) => batchFindUnique(...a),
    },
    photo: {
      create: (...a: unknown[]) => photoCreate(...a),
    },
  },
}));

vi.mock("@/lib/breaking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/breaking")>();
  return {
    ...actual,
    registerDirectPiece: (...a: unknown[]) => registerDirectPiece(...a),
  };
});

vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...(a as [string])),
}));

import { submitSingan } from "@/app/singan/actions";

const DRAFT = encodeShapeDraft({
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  fileId: "AgACAgIAAxkBAAIB-testfileid001",
});

function fd(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set("d", DRAFT);
  f.set("side_1", "100");
  f.set("side_2", "80");
  f.set("side_3", "100");
  f.set("side_4", "80");
  f.set("boundingLengthMm", "100");
  f.set("boundingWidthMm", "80");
  f.set("thicknessMm", "2");
  f.set("areaM2", "0.8");
  f.set("kind", "BROKEN");
  f.set("batchId", "batch1");
  f.set("block", "А");
  f.set("landmark", "2");
  f.set("breakCause", "MOVE_BREAK");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

async function expectRedirect(run: () => Promise<void>): Promise<string> {
  try {
    await run();
    throw new Error("expected redirect");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = msg.match(/^NEXT_REDIRECT:(.+)$/);
    if (!m) throw e;
    return m[1]!;
  }
}

beforeEach(() => {
  getCapabilities.mockReset();
  currentActorId.mockReset();
  registerDirectPiece.mockReset();
  batchFindUnique.mockReset();
  photoCreate.mockReset();
  redirect.mockClear();

  getCapabilities.mockResolvedValue({ canManageWarehouse: true });
  currentActorId.mockResolvedValue("wh1");
  batchFindUnique.mockResolvedValue({ stoneTypeId: "stone1" });
  registerDirectPiece.mockResolvedValue({
    pieceId: "piece1",
    areaM2: 0.8,
    areaEstimated: false,
    slabsFreeAfter: 9,
    areaFreeM2After: 50,
  });
  photoCreate.mockResolvedValue({ id: "photo1" });
});

describe("submitSingan — photo honesty (round2)", () => {
  it("photo create ok → ok=1 without photoWarn", async () => {
    const url = await expectRedirect(() => submitSingan(fd()));
    expect(registerDirectPiece).toHaveBeenCalledTimes(1);
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(url).toMatch(/ok=1/);
    expect(url).not.toMatch(/photoWarn/);
    expect(url).toMatch(/stone=stone1/);
  });

  it("photo create fails → does NOT report plain success (photoWarn=1)", async () => {
    photoCreate.mockRejectedValue(new Error("db photo down"));
    const url = await expectRedirect(() => submitSingan(fd()));
    // Piece still written (transaction already committed)
    expect(registerDirectPiece).toHaveBeenCalledTimes(1);
    expect(photoCreate).toHaveBeenCalledTimes(1);
    // Honest partial: ok + photoWarn, not silent green "photo saved"
    expect(url).toMatch(/ok=1/);
    expect(url).toMatch(/photoWarn=1/);
    // Must not be a plain success URL without warn
    const plainSuccess =
      url.includes("ok=1") && !url.includes("photoWarn");
    expect(plainSuccess).toBe(false);
  });

  it("no warehouse access → err, no piece write", async () => {
    getCapabilities.mockResolvedValue({ canManageWarehouse: false });
    const url = await expectRedirect(() => submitSingan(fd()));
    expect(registerDirectPiece).not.toHaveBeenCalled();
    expect(url).toMatch(/err=/);
    expect(url).not.toMatch(/ok=1/);
  });
});
