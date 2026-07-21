// TG-B1 / BUG-04 — fotozapros yaratish + dispatch + re-dispatch testlari
// (real DB / real Telegram YO'Q). deps (db, sendMessage) inyeksiya qilinadi — mock.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DISPATCH_ATTEMPTS,
  PhotoRequestError,
  buildTaskText,
  createAndDispatchPhotoRequest,
  redispatchPendingPhotoRequests,
  type PhotoRequestDeps,
} from "@/lib/photo-requests";

// ── Mock deps ──
const batchFindUnique = vi.fn();
const photoRequestCreate = vi.fn();
const photoRequestFindMany = vi.fn();
const userFindMany = vi.fn();
const photoDispatchUpsert = vi.fn();
const auditLogCreate = vi.fn();
const sendMessage = vi.fn();

function makeDeps(): PhotoRequestDeps {
  return {
    db: {
      batch: { findUnique: (...a: unknown[]) => batchFindUnique(...a) },
      photoRequest: {
        create: (...a: unknown[]) => photoRequestCreate(...a),
        findMany: (...a: unknown[]) => photoRequestFindMany(...a),
      },
      user: { findMany: (...a: unknown[]) => userFindMany(...a) },
      photoDispatch: { upsert: (...a: unknown[]) => photoDispatchUpsert(...a) },
      auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
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
  photoRequestFindMany.mockReset();
  userFindMany.mockReset();
  photoDispatchUpsert.mockReset();
  auditLogCreate.mockReset();
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
  photoDispatchUpsert.mockResolvedValue(undefined);
  auditLogCreate.mockResolvedValue(undefined);
  // BUG-04: sendMessage endi SendResult qaytaradi (void emas).
  // §5.3: SendResult SENT'da message_id ham beradi (reply-to bog'lash uchun).
  sendMessage.mockResolvedValue({ ok: true, messageId: 7001 });
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
    expect(sendMessage.mock.calls[0][1]).toContain("Блок А");
    expect(sendMessage.mock.calls[0][1]).toContain("ориентир 2");

    // BUG-04: каждая доставка записана SENT + AuditLog.
    expect(photoDispatchUpsert).toHaveBeenCalledTimes(2);
    expect(photoDispatchUpsert.mock.calls[0][0].create).toMatchObject({
      photoRequestId: "pr1",
      chatId: "111",
      status: "SENT",
    });
    expect(auditLogCreate).toHaveBeenCalledTimes(2);
    expect(auditLogCreate.mock.calls[0][0].data).toMatchObject({
      action: "PHOTO_REQUEST",
      entityType: "PhotoRequest",
      entityId: "pr1",
    });

    expect(res.request.status).toBe("PENDING");
    expect(res.request.assigneeId).toBeNull();
    expect(res.dispatchedTo).toBe(2);
    expect(res.noWorkers).toBe(false);
  });

  it("§5.3: message_id из отправки сохраняется в PhotoDispatch (для reply-to привязки)", async () => {
    sendMessage
      .mockResolvedValueOnce({ ok: true, messageId: 4242 })
      .mockResolvedValueOnce({ ok: true, messageId: 4243 });

    await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1" },
      makeDeps(),
    );

    // Каждый складчик получает свой message_id → он ложится в свою запись.
    expect(photoDispatchUpsert.mock.calls[0][0].create).toMatchObject({
      chatId: "111",
      status: "SENT",
      messageId: 4242,
    });
    expect(photoDispatchUpsert.mock.calls[1][0].create).toMatchObject({
      chatId: "222",
      status: "SENT",
      messageId: 4243,
    });
  });

  it("§5.3: FAILED (нет доставки) → messageId=null в PhotoDispatch", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "http_403: blocked" });

    await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1" },
      makeDeps(),
    );

    expect(photoDispatchUpsert.mock.calls[0][0].create).toMatchObject({
      status: "FAILED",
      messageId: null,
    });
  });

  it("комментарий пробрасывается в запрос и в текст задачи", async () => {
    await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1", comment: "срочно" },
      makeDeps(),
    );
    expect(photoRequestCreate.mock.calls[0][0].data.comment).toBe("срочно");
    expect(sendMessage.mock.calls[0][1]).toContain("срочно");
  });

  it("BUG-04: сбой sendMessage (ok:false) не бросает, пишется FAILED, dispatchedTo считает только SENT", async () => {
    sendMessage
      .mockResolvedValueOnce({ ok: false, error: "http_403: blocked" })
      .mockResolvedValueOnce({ ok: true });

    const res = await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1" },
      makeDeps(),
    );

    expect(sendMessage).toHaveBeenCalledTimes(2);
    // Первый — FAILED с lastError, второй — SENT.
    expect(photoDispatchUpsert.mock.calls[0][0].create).toMatchObject({
      status: "FAILED",
      lastError: "http_403: blocked",
    });
    expect(photoDispatchUpsert.mock.calls[1][0].create).toMatchObject({
      status: "SENT",
    });
    // Аудит фиксирует и провал (delivered:false), и успех (delivered:true).
    expect(auditLogCreate.mock.calls[0][0].data.payload).toMatchObject({
      delivered: false,
      error: "http_403: blocked",
    });
    expect(res.dispatchedTo).toBe(1); // один упал, один дошёл — считаем только SENT
    expect(res.noWorkers).toBe(false);
  });

  it("BUG-04: складчики ЕСТЬ, но КАЖДЫЙ send упал → dispatchedTo=0, noWorkers=false (ветка ?photo=nodelivery)", async () => {
    // Все доставки FAILED (напр. бот заблокирован у всех). Это НЕ noWorkers —
    // складчики привязаны, просто ни один не получил → менеджер видит nodelivery.
    sendMessage.mockResolvedValue({ ok: false, error: "http_403: blocked" });

    const res = await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1" },
      makeDeps(),
    );

    expect(sendMessage).toHaveBeenCalledTimes(2);
    // Обе доставки записаны FAILED.
    expect(photoDispatchUpsert).toHaveBeenCalledTimes(2);
    expect(
      photoDispatchUpsert.mock.calls.every(
        (c) => c[0].create.status === "FAILED",
      ),
    ).toBe(true);
    expect(res.dispatchedTo).toBe(0);
    expect(res.noWorkers).toBe(false); // склад есть, доставки нет
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

  it("BUG-04: нет складчиков с telegramId → noWorkers:true, dispatchedTo=0, аудит НЕ молчит", async () => {
    userFindMany.mockResolvedValue([]);
    const res = await createAndDispatchPhotoRequest(
      { managerId: "m1", batchId: "b1", batchLocationId: "loc1" },
      makeDeps(),
    );
    expect(photoRequestCreate).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(photoDispatchUpsert).not.toHaveBeenCalled();
    // Провал доставки виден в Истории (§8).
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate.mock.calls[0][0].data.payload).toMatchObject({
      noWorkers: true,
      delivered: 0,
    });
    expect(res.dispatchedTo).toBe(0);
    expect(res.noWorkers).toBe(true);
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
    expect(sendMessage.mock.calls[0][1]).toContain("Блок Б");
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
    expect(sendMessage.mock.calls[0][1]).toContain("Блок В");
  });
});

// ───────────────────── BUG-04 re-dispatch (lazy sweep) ─────────────────────

/** Мини-фабрика PENDING-строки для redispatch-тестов. */
function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pr1",
    comment: null,
    batch: {
      stoneType: { name: "Травертин" },
      locations: [{ id: "loc1", block: "А", landmark: "2" }],
    },
    batchLocation: { block: "А", landmark: "2" },
    dispatches: [],
    // §6.1 — запрос теперь остаётся PENDING и после фото; «отвечен» = есть фото.
    photos: [],
    ...overrides,
  };
}

describe("redispatchPendingPhotoRequests", () => {
  it("складчик привязал Telegram ПОСЛЕ запроса (нет записи) → до-отправка", async () => {
    photoRequestFindMany.mockResolvedValue([pendingRow({ dispatches: [] })]);
    userFindMany.mockResolvedValue([{ id: "w1", telegramId: "111" }]);

    const res = await redispatchPendingPhotoRequests(makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe("111");
    expect(sendMessage.mock.calls[0][1]).toContain("Травертин");
    expect(photoDispatchUpsert.mock.calls[0][0].create).toMatchObject({
      status: "SENT",
    });
    expect(res).toEqual({ retried: 1, delivered: 1 });
  });

  it("прошлая доставка FAILED (attempts<max) → повторная попытка", async () => {
    photoRequestFindMany.mockResolvedValue([
      pendingRow({
        dispatches: [{ chatId: "111", status: "FAILED", attempts: 1 }],
      }),
    ]);
    userFindMany.mockResolvedValue([{ id: "w1", telegramId: "111" }]);

    const res = await redispatchPendingPhotoRequests(makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ retried: 1, delivered: 1 });
  });

  it("граница ретрая: attempts=2 (<max) → повтор, upsert доводит attempts до max", async () => {
    // attempts=2 всё ещё < MAX_DISPATCH_ATTEMPTS(3) → должна быть ещё попытка.
    photoRequestFindMany.mockResolvedValue([
      pendingRow({
        dispatches: [{ chatId: "111", status: "FAILED", attempts: 2 }],
      }),
    ]);
    userFindMany.mockResolvedValue([{ id: "w1", telegramId: "111" }]);

    const res = await redispatchPendingPhotoRequests(makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    // upsert.update.attempts инкрементит на 1 → 2 достигает 3 (следующий sweep пропустит).
    expect(photoDispatchUpsert.mock.calls[0][0].update.attempts).toEqual({
      increment: 1,
    });
    expect(res).toEqual({ retried: 1, delivered: 1 });
  });

  it("§6.1 — запрос уже с фото (отвечен) → пропуск, складчиков НЕ дёргаем повторно", async () => {
    // Запрос PENDING (не закрывается на первом фото), но фото уже пришло →
    // складчик получил задачу и отвечает. Ни одной новой отправки быть не должно,
    // даже если у складчика нет записи о доставке.
    photoRequestFindMany.mockResolvedValue([
      pendingRow({ dispatches: [], photos: [{ id: "ph1" }] }),
    ]);
    userFindMany.mockResolvedValue([{ id: "w1", telegramId: "111" }]);

    const res = await redispatchPendingPhotoRequests(makeDeps());

    expect(sendMessage).not.toHaveBeenCalled();
    expect(res).toEqual({ retried: 0, delivered: 0 });
  });

  it("уже SENT → пропуск (не шлём повторно)", async () => {
    photoRequestFindMany.mockResolvedValue([
      pendingRow({
        dispatches: [{ chatId: "111", status: "SENT", attempts: 1 }],
      }),
    ]);
    userFindMany.mockResolvedValue([{ id: "w1", telegramId: "111" }]);

    const res = await redispatchPendingPhotoRequests(makeDeps());

    expect(sendMessage).not.toHaveBeenCalled();
    expect(res).toEqual({ retried: 0, delivered: 0 });
  });

  it("исчерпан лимит попыток (attempts>=max) → пропуск", async () => {
    photoRequestFindMany.mockResolvedValue([
      pendingRow({
        dispatches: [
          { chatId: "111", status: "FAILED", attempts: MAX_DISPATCH_ATTEMPTS },
        ],
      }),
    ]);
    userFindMany.mockResolvedValue([{ id: "w1", telegramId: "111" }]);

    const res = await redispatchPendingPhotoRequests(makeDeps());

    expect(sendMessage).not.toHaveBeenCalled();
    expect(res).toEqual({ retried: 0, delivered: 0 });
  });

  it("нет PENDING-запросов → ничего не делает", async () => {
    photoRequestFindMany.mockResolvedValue([]);
    const res = await redispatchPendingPhotoRequests(makeDeps());
    expect(userFindMany).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(res).toEqual({ retried: 0, delivered: 0 });
  });

  it("окно: findMany фильтрует PENDING + недавние (createdAt gte)", async () => {
    photoRequestFindMany.mockResolvedValue([]);
    await redispatchPendingPhotoRequests(makeDeps());
    const arg = photoRequestFindMany.mock.calls[0][0];
    expect(arg.where.status).toBe("PENDING");
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
  });
});

describe("buildTaskText", () => {
  it("включает камень, блок, ориентир и комментарий", () => {
    const t = buildTaskText("Травертин", { block: "А", landmark: "2" }, "срочно");
    expect(t).toContain("Травертин");
    expect(t).toContain("Блок А");
    expect(t).toContain("ориентир 2");
    expect(t).toContain("срочно");
    expect(t).toContain("reply");
  });

  it("без локации → «Локация не указана», без комментария", () => {
    const t = buildTaskText("Мрамор", null, null);
    expect(t).toContain("Мрамор");
    expect(t).toContain("Локация не указана");
    expect(t).not.toContain("Комментарий");
  });
});
