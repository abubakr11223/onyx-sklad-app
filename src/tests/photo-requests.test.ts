// TG-B1 — fotozapros yaratish + dispatch testlari (real DB / real Telegram YO'Q).
// deps (db, sendMessage) inyeksiya qilinadi — mock uzatamiz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PhotoRequestError,
  buildTaskText,
  createAndDispatchPhotoRequest,
  type PhotoRequestDeps,
} from "@/lib/photo-requests";

// ── Mock deps ──
const batchFindUnique = vi.fn();
const photoRequestCreate = vi.fn();
const userFindMany = vi.fn();
const sendMessage = vi.fn();

function makeDeps(): PhotoRequestDeps {
  return {
    db: {
      batch: { findUnique: (...a: unknown[]) => batchFindUnique(...a) },
      photoRequest: { create: (...a: unknown[]) => photoRequestCreate(...a) },
      user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    },
    sendMessage: (...a: unknown[]) => sendMessage(...a),
  } as unknown as PhotoRequestDeps;
}

const BATCH = {
  id: "b1",
  stoneType: { name: "Травертин" },
  locations: [
    { id: "loc1", block: "А", landmark: "2" },
    { id: "loc2", block: "Б", landmark: "5" },
  ],
};

beforeEach(() => {
  batchFindUnique.mockReset();
  photoRequestCreate.mockReset();
  userFindMany.mockReset();
  sendMessage.mockReset();

  batchFindUnique.mockResolvedValue(BATCH);
  photoRequestCreate.mockImplementation(async (args: { data: unknown }) => ({
    id: "pr1",
    ...(args.data as Record<string, unknown>),
  }));
  userFindMany.mockResolvedValue([
    { id: "w1", telegramId: "111" },
    { id: "w2", telegramId: "222" },
  ]);
  sendMessage.mockResolvedValue(undefined);
});

describe("createAndDispatchPhotoRequest", () => {
  it("создаёт PENDING-запрос (assigneeId=null) и шлёт каждому складчику", async () => {
    const res = await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1" },
      makeDeps(),
    );

    // PhotoRequest.create — правильные данные.
    expect(photoRequestCreate).toHaveBeenCalledTimes(1);
    expect(photoRequestCreate.mock.calls[0][0].data).toMatchObject({
      managerId: "m1",
      batchId: "b1",
      batchLocationId: "loc1",
      assigneeId: null,
      status: "PENDING",
      comment: null,
    });

    // findMany where-фильтр: WAREHOUSE + isActive + telegramId not null.
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: "WAREHOUSE",
          isActive: true,
          telegramId: { not: null },
        },
      }),
    );

    // sendMessage — по разу на каждого складчика с telegramId.
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toBe("111");
    expect(sendMessage.mock.calls[1][0]).toBe("222");
    // Текст содержит имя камня и выбранную локацию.
    expect(sendMessage.mock.calls[0][1]).toContain("Травертин");
    expect(sendMessage.mock.calls[0][1]).toContain("Blok А");
    expect(sendMessage.mock.calls[0][1]).toContain("orientir 2");

    expect(res.request.status).toBe("PENDING");
    expect(res.request.assigneeId).toBeNull();
    expect(res.dispatchedTo).toBe(2);
  });

  it("комментарий пробрасывается в запрос и в текст задачи", async () => {
    await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1", comment: "срочно" },
      makeDeps(),
    );
    expect(photoRequestCreate.mock.calls[0][0].data.comment).toBe("срочно");
    expect(sendMessage.mock.calls[0][1]).toContain("срочно");
  });

  it("сбой sendMessage у одного складчика не мешает остальным и не бросает", async () => {
    sendMessage
      .mockRejectedValueOnce(new Error("telegram down"))
      .mockResolvedValueOnce(undefined);

    const res = await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1" },
      makeDeps(),
    );

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(res.dispatchedTo).toBe(1); // один упал, один дошёл
  });

  it("партия не найдена → PhotoRequestError, запрос не создаётся", async () => {
    batchFindUnique.mockResolvedValue(null);
    await expect(
      createAndDispatchPhotoRequest(
        { managerId: "m1", batchId: "nope" },
        makeDeps(),
      ),
    ).rejects.toBeInstanceOf(PhotoRequestError);
    expect(photoRequestCreate).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("пустой batchId → PhotoRequestError (VALIDATION), DB не трогается", async () => {
    await expect(
      createAndDispatchPhotoRequest({ managerId: "m1", batchId: "  " }, makeDeps()),
    ).rejects.toBeInstanceOf(PhotoRequestError);
    expect(batchFindUnique).not.toHaveBeenCalled();
  });

  it("нет складчиков с telegramId → запрос создаётся, dispatchedTo=0", async () => {
    userFindMany.mockResolvedValue([]);
    const res = await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1" },
      makeDeps(),
    );
    expect(photoRequestCreate).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(res.dispatchedTo).toBe(0);
  });

  it("batchLocationId не из этой партии → VALIDATION, запрос не создаётся", async () => {
    await expect(
      createAndDispatchPhotoRequest(
        { managerId: "m1", batchId: "b1", batchLocationId: "loc-foreign" },
        makeDeps(),
      ),
    ).rejects.toBeInstanceOf(PhotoRequestError);
    expect(photoRequestCreate).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("выбранная локация пишется как chosen.id (не сырой ввод)", async () => {
    await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc2" },
      makeDeps(),
    );
    expect(photoRequestCreate.mock.calls[0][0].data.batchLocationId).toBe("loc2");
    expect(sendMessage.mock.calls[0][1]).toContain("Blok Б");
  });

  it("локация не выбрана, у партии одна локация → она берётся в текст", async () => {
    batchFindUnique.mockResolvedValue({
      id: "b1",
      stoneType: { name: "Мрамор" },
      locations: [{ id: "only", block: "В", landmark: "7" }],
    });
    await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1" },
      makeDeps(),
    );
    expect(photoRequestCreate.mock.calls[0][0].data.batchLocationId).toBeNull();
    expect(sendMessage.mock.calls[0][1]).toContain("Blok В");
  });
});

describe("buildTaskText", () => {
  it("включает камень, блок, ориентир и комментарий", () => {
    const t = buildTaskText("Травертин", { block: "А", landmark: "2" }, "срочно");
    expect(t).toContain("Травертин");
    expect(t).toContain("Blok А");
    expect(t).toContain("orientir 2");
    expect(t).toContain("срочно");
    expect(t).toContain("Rasmni");
  });

  it("без локации → «Lokatsiya ko'rsatilmagan», без комментария", () => {
    const t = buildTaskText("Мрамор", null, null);
    expect(t).toContain("Мрамор");
    expect(t).toContain("Lokatsiya ko'rsatilmagan");
    expect(t).not.toContain("Izoh");
  });
});
