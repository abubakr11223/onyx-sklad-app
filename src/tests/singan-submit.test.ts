// /singan — «Бой по фото» submit. Покрывает round2 (честность photoWarn) и
// W3-T2: дробная толщина, сохранение введённого при ошибке, защита от двойной
// отправки (mutationId), блок только из карты склада.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeShapeDraft } from "@/lib/singan";

const getCapabilities = vi.fn();
const currentActorId = vi.fn();
const registerDirectPiece = vi.fn();
const batchFindUnique = vi.fn();
const photoCreate = vi.fn();
const warehouseBlockFindMany = vi.fn();
const redirect = vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
  throw err;
});

/** Поддельный MutationReceipt: PK-конфликт даёт P2002, как в Postgres. */
const receipts = new Map<
  string,
  { entityId: string; resultJson: unknown }
>();
const receiptCreate = vi.fn(
  async (args: {
    data: { mutationId: string; entityId: string; resultJson?: unknown };
  }) => {
    if (receipts.has(args.data.mutationId)) {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    }
    receipts.set(args.data.mutationId, {
      entityId: args.data.entityId,
      resultJson: args.data.resultJson ?? null,
    });
    return args.data;
  },
);

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
    warehouseBlock: {
      findMany: (...a: unknown[]) => warehouseBlockFindMany(...a),
    },
    mutationReceipt: {
      findUnique: async ({ where }: { where: { mutationId: string } }) =>
        receipts.get(where.mutationId) ?? null,
      create: (args: {
        data: { mutationId: string; entityId: string; resultJson?: unknown };
      }) => receiptCreate(args),
      update: async ({
        where,
        data,
      }: {
        where: { mutationId: string };
        data: { entityId: string; resultJson: unknown };
      }) => {
        receipts.set(where.mutationId, {
          entityId: data.entityId,
          resultJson: data.resultJson,
        });
        return data;
      },
      delete: async ({ where }: { where: { mutationId: string } }) => {
        receipts.delete(where.mutationId);
        return {};
      },
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

import { submitSingan, type SinganFormState } from "@/app/singan/actions";

const DRAFT = encodeShapeDraft({
  vertices: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  fileId: "AgACAgIAAxkBAAIB-testfileid001",
});

const MUT_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const EMPTY: SinganFormState = { errors: {} };

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
  f.set("block", "А"); // кириллица — нормализуется в латинскую «A» карты
  f.set("landmark", "2");
  f.set("breakCause", "MOVE_BREAK");
  f.set("mutationId", MUT_A);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

async function expectRedirect(run: () => Promise<unknown>): Promise<string> {
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
  warehouseBlockFindMany.mockReset();
  receiptCreate.mockClear();
  receipts.clear();
  redirect.mockClear();

  getCapabilities.mockResolvedValue({ canManageWarehouse: true });
  currentActorId.mockResolvedValue("wh1");
  batchFindUnique.mockResolvedValue({ stoneTypeId: "stone1" });
  warehouseBlockFindMany.mockResolvedValue([
    { letter: "A", landmarks: [{ number: "2" }, { number: "3" }] },
  ]);
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
    const url = await expectRedirect(() => submitSingan(EMPTY, fd()));
    expect(registerDirectPiece).toHaveBeenCalledTimes(1);
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(url).toMatch(/ok=1/);
    expect(url).not.toMatch(/photoWarn/);
    expect(url).toMatch(/stone=stone1/);
  });

  it("photo create fails → does NOT report plain success (photoWarn=1)", async () => {
    photoCreate.mockRejectedValue(new Error("db photo down"));
    const url = await expectRedirect(() => submitSingan(EMPTY, fd()));
    expect(registerDirectPiece).toHaveBeenCalledTimes(1);
    expect(url).toMatch(/ok=1/);
    expect(url).toMatch(/photoWarn=1/);
  });

  it("no warehouse access → form error, no piece write", async () => {
    getCapabilities.mockResolvedValue({ canManageWarehouse: false });
    const state = await submitSingan(EMPTY, fd());
    expect(registerDirectPiece).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(state.errors.form).toMatch(/Нет доступа/);
  });
});

// ── W3-T2 (a) — дробная толщина, как в /razbit (ТЗ №12) ──
describe("submitSingan — толщина", () => {
  it("«1,8» принимается (18 мм) и уходит в кусок как 1.8", async () => {
    await expectRedirect(() => submitSingan(EMPTY, fd({ thicknessMm: "1,8" })));
    expect(registerDirectPiece.mock.calls[0][0].thicknessMm).toBe(1.8);
  });

  it("точка «1.8» тоже принимается", async () => {
    await expectRedirect(() => submitSingan(EMPTY, fd({ thicknessMm: "1.8" })));
    expect(registerDirectPiece.mock.calls[0][0].thicknessMm).toBe(1.8);
  });

  it("целое «2» по-прежнему принимается", async () => {
    await expectRedirect(() => submitSingan(EMPTY, fd({ thicknessMm: "2" })));
    expect(registerDirectPiece.mock.calls[0][0].thicknessMm).toBe(2);
  });

  it("пусто = толщина не указана (null), кусок пишется", async () => {
    await expectRedirect(() => submitSingan(EMPTY, fd({ thicknessMm: "" })));
    expect(registerDirectPiece.mock.calls[0][0].thicknessMm).toBeNull();
  });

  it("мусор → ошибка поля, кусок НЕ пишется", async () => {
    const state = await submitSingan(EMPTY, fd({ thicknessMm: "толстая" }));
    expect(registerDirectPiece).not.toHaveBeenCalled();
    expect(state.errors.thicknessMm).toMatch(/1,8/);
  });
});

// ── W3-T2 (b) — ошибка НЕ стирает введённое ──
describe("submitSingan — введённое переживает ошибку", () => {
  it("ошибка валидации возвращает все значения формы", async () => {
    const state = await submitSingan(
      EMPTY,
      fd({ boundingLengthMm: "нет", landmark: "3", breakCauseNote: "угол" }),
    );
    expect(registerDirectPiece).not.toHaveBeenCalled();
    expect(state.errors.boundingLengthMm).toBeTruthy();
    // Ни одна сторона и ни одно поле не должны потеряться.
    expect(state.values?.sides).toEqual(["100", "80", "100", "80"]);
    expect(state.values?.boundingWidthMm).toBe("80");
    expect(state.values?.thicknessMm).toBe("2");
    expect(state.values?.areaM2).toBe("0.8");
    expect(state.values?.kind).toBe("BROKEN");
    expect(state.values?.batchId).toBe("batch1");
    expect(state.values?.block).toBe("А");
    expect(state.values?.landmark).toBe("3");
    expect(state.values?.breakCause).toBe("MOVE_BREAK");
    expect(state.values?.breakCauseNote).toBe("угол");
    // Никакого redirect ?err= — ошибка живёт в состоянии формы.
    expect(redirect).not.toHaveBeenCalled();
  });

  it("ошибка стороны адресуется в своё поле (side_2)", async () => {
    const state = await submitSingan(EMPTY, fd({ side_2: "0" }));
    expect(state.errors.side_2).toBeTruthy();
    expect(state.values?.sides).toEqual(["100", "0", "100", "80"]);
  });
});

// ── W3-T2 (c) — двойная отправка ──
describe("submitSingan — двойная отправка", () => {
  it("тот же mutationId дважды → ОДИН кусок, вторая отправка = тот же успех", async () => {
    const first = await expectRedirect(() => submitSingan(EMPTY, fd()));
    const second = await expectRedirect(() => submitSingan(EMPTY, fd()));
    expect(registerDirectPiece).toHaveBeenCalledTimes(1);
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(first).toMatch(/ok=1/);
    expect(second).toMatch(/ok=1/);
    expect(second).toMatch(/stone=stone1/);
  });

  it("новый mutationId → второй кусок (это уже другой бой)", async () => {
    await expectRedirect(() => submitSingan(EMPTY, fd()));
    await expectRedirect(() =>
      submitSingan(EMPTY, fd({ mutationId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" })),
    );
    expect(registerDirectPiece).toHaveBeenCalledTimes(2);
  });

  it("неудачная запись снимает заявку — повтор с тем же id проходит", async () => {
    const { BreakError } = await import("@/lib/breaking");
    registerDirectPiece.mockRejectedValueOnce(
      new BreakError("INSUFFICIENT_REMAINDER", "Нет свободных плит"),
    );
    const failed = await submitSingan(EMPTY, fd());
    expect(failed.errors.form).toMatch(/Нет свободных плит/);
    // Заявка снята → тот же mutationId снова пишет (первый раз куска не было).
    const url = await expectRedirect(() => submitSingan(EMPTY, fd()));
    expect(url).toMatch(/ok=1/);
    expect(registerDirectPiece).toHaveBeenCalledTimes(2);
  });

  it("без mutationId — отказ, кусок не пишется", async () => {
    const f = fd();
    f.delete("mutationId");
    const state = await submitSingan(EMPTY, f);
    expect(registerDirectPiece).not.toHaveBeenCalled();
    expect(state.errors.form).toMatch(/устарела/);
    expect(state.values?.sides).toEqual(["100", "80", "100", "80"]);
  });
});

// ── W3-T2 (d) — блок из карты склада, ориентир необязателен (ТЗ №18 §2) ──
describe("submitSingan — локация", () => {
  it("блока нет в карте → ошибка поля, кусок НЕ пишется", async () => {
    const state = await submitSingan(EMPTY, fd({ block: "Z9", landmark: "" }));
    expect(registerDirectPiece).not.toHaveBeenCalled();
    expect(state.errors.block).toMatch(/нет в карте склада/);
  });

  it("ориентира нет в блоке → ошибка ориентира", async () => {
    const state = await submitSingan(EMPTY, fd({ landmark: "99" }));
    expect(registerDirectPiece).not.toHaveBeenCalled();
    expect(state.errors.landmark).toMatch(/ориентира/);
  });

  it("пустой ориентир допустим — кусок числится за блоком целиком", async () => {
    await expectRedirect(() => submitSingan(EMPTY, fd({ landmark: "" })));
    expect(registerDirectPiece.mock.calls[0][0].landmark).toBe("");
    expect(registerDirectPiece.mock.calls[0][0].block).toBe("A");
  });

  it("пустой блок → ошибка (адреса у куска нет)", async () => {
    const state = await submitSingan(EMPTY, fd({ block: "" }));
    expect(registerDirectPiece).not.toHaveBeenCalled();
    expect(state.errors.block).toBeTruthy();
  });
});
