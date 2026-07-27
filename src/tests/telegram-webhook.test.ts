// TG-A — telegram webhook sof handler testlari (real DB / real Telegram YO'Q).
// deps (db, sendMessage) inyeksiya qilinadi — mock uzatamiz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TgUpdate } from "@/lib/telegram";
import {
  handleUpdate,
  normalizePhone,
  type WebhookDeps,
} from "@/lib/telegram-webhook";
import { decodeShapeDraft } from "@/lib/singan";

// ── Mock deps ──
const findMany = vi.fn();
const update = vi.fn();
const sendMessage = vi.fn();
// TG-B2 (foto) uchun qo'shimcha mock'lar.
const userFindFirst = vi.fn();
const userFindUnique = vi.fn();
const prFindFirst = vi.fn();
const prUpdate = vi.fn(); // ТЗ №3 — узор-запрос закрывается (DONE)
const photoCreate = vi.fn();
// §4.1 L3 / §6.1 — ajratilgan Slab endi deps.separateSlab (транзакция+guard —
// slab-separation.ts, отдельный тест). Здесь мокаем сам инъектируемый вызов.
const separateSlabMock = vi.fn();
// §5.3 — reply-to bo'yicha PhotoDispatch qidirish mock'i.
const pdFindFirst = vi.fn();
// SK-4b: magic-link imzolovchisi mock'i.
const tarUpsert = vi.fn(); // onboarding — заявка на доступ (upsert)
const findOwnersWithTelegram = vi.fn(); // push OWNER'ам о новой tg-заявке
const signMagicLinkToken = vi.fn();
// §5.5b (singan tosh) mock'lari.
const downloadPhotoBase64 = vi.fn();
const analyzeShape = vi.fn();

function makeDeps(overrides?: Partial<WebhookDeps>): WebhookDeps {
  return {
    db: {
      user: {
        findMany: (...a: unknown[]) => findMany(...a),
        update: (...a: unknown[]) => update(...a),
        findFirst: (...a: unknown[]) => userFindFirst(...a),
        findUnique: (...a: unknown[]) => userFindUnique(...a),
      },
      telegramAccessRequest: {
        upsert: (...a: unknown[]) => tarUpsert(...a),
      },
      photoRequest: {
        findFirst: (...a: unknown[]) => prFindFirst(...a),
        update: (...a: unknown[]) => prUpdate(...a),
      },
      photoDispatch: {
        findFirst: (...a: unknown[]) => pdFindFirst(...a),
      },
      photo: {
        create: (...a: unknown[]) => photoCreate(...a),
      },
    },
    sendMessage: (...a: unknown[]) => sendMessage(...a),
    findOwnersWithTelegram: (...a: unknown[]) => findOwnersWithTelegram(...a),
    signMagicLinkToken: (...a: unknown[]) => signMagicLinkToken(...a),
    appBaseUrl: "https://onyx.test",
    downloadPhotoBase64: (...a: unknown[]) => downloadPhotoBase64(...a),
    analyzeShape: (...a: unknown[]) => analyzeShape(...a),
    separateSlab: (...a: unknown[]) => separateSlabMock(...a),
    ...overrides,
  } as unknown as WebhookDeps;
}

beforeEach(() => {
  findMany.mockReset();
  update.mockReset();
  sendMessage.mockReset();
  userFindFirst.mockReset();
  userFindUnique.mockReset();
  prFindFirst.mockReset();
  prUpdate.mockReset();
  photoCreate.mockReset();
  separateSlabMock.mockReset();
  pdFindFirst.mockReset();
  tarUpsert.mockReset();
  tarUpsert.mockResolvedValue({});
  findOwnersWithTelegram.mockReset();
  findOwnersWithTelegram.mockResolvedValue([]);
  findMany.mockResolvedValue([]);
  update.mockResolvedValue({});
  sendMessage.mockResolvedValue(undefined);
  userFindFirst.mockResolvedValue(null);
  userFindUnique.mockResolvedValue(null);
  prFindFirst.mockResolvedValue(null);
  prUpdate.mockResolvedValue({});
  photoCreate.mockResolvedValue({});
  separateSlabMock.mockResolvedValue("slab1");
  pdFindFirst.mockResolvedValue(null);
  signMagicLinkToken.mockReset();
  signMagicLinkToken.mockResolvedValue("SIGNED_TOKEN");
  downloadPhotoBase64.mockReset();
  analyzeShape.mockReset();
  downloadPhotoBase64.mockResolvedValue({ base64: "QUJD", mediaType: "image/jpeg" });
  analyzeShape.mockResolvedValue({ sideCount: 4, vertices: QUAD });
});

// §5.5b — mock AI qaytaradigan standart polygon.
const QUAD = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// ── Update yasovchilar ──
function startUpdate(chatId = 555): TgUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: chatId },
      chat: { id: chatId },
      text: "/start",
    },
  };
}

function contactUpdate(opts: {
  chatId?: number;
  fromId?: number;
  contactUserId?: number | undefined;
  phone: string;
}): TgUpdate {
  const chatId = opts.chatId ?? 555;
  const fromId = opts.fromId ?? chatId;
  // "contactUserId" in opts kaliti berilmagan bo'lsa — o'z kontakti (= fromId).
  const contactUserId =
    "contactUserId" in opts ? opts.contactUserId : fromId;
  return {
    update_id: 2,
    message: {
      message_id: 11,
      from: { id: fromId },
      chat: { id: chatId },
      contact: {
        phone_number: opts.phone,
        first_name: "Ali",
        user_id: contactUserId,
      },
    },
  };
}

describe("normalizePhone", () => {
  it("faqat raqamlarni qoldiradi", () => {
    expect(normalizePhone("+998 90 123-45-67")).toBe("998901234567");
    expect(normalizePhone("998901234567")).toBe("998901234567");
    expect(normalizePhone("(998) 90 1234567")).toBe("998901234567");
    expect(normalizePhone("+998-90-123-45-67")).toBe("998901234567");
  });
  it("bo'sh/null/undefined → bo'sh satr", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("/start — kontakt so'rovi", () => {
  it("request_contact klaviaturasi bilan javob, DB yozuv YO'Q", async () => {
    await handleUpdate(startUpdate(777), makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = sendMessage.mock.calls[0];
    expect(chatId).toBe(777);
    expect(typeof text).toBe("string");
    expect(opts.reply_markup.keyboard[0][0]).toMatchObject({
      request_contact: true,
    });
    expect(opts.reply_markup.one_time_keyboard).toBe(true);
    expect(opts.reply_markup.resize_keyboard).toBe(true);

    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("/start@BotName ham ishlaydi", async () => {
    const upd = startUpdate(777);
    upd.message!.text = "/start@OnyxSkladBot";
    await handleUpdate(upd, makeDeps());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][2].reply_markup.keyboard[0][0]).toMatchObject(
      { request_contact: true },
    );
  });

  it("/startfoo (yopishgan) → /start deb qabul QILINMAYDI", async () => {
    const upd = startUpdate(777);
    upd.message!.text = "/startfoo";
    await handleUpdate(upd, makeDeps());
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("kontakt → foydalanuvchini bog'lash", () => {
  it("mos telefon (saqlangan +998 vs ulashgan 998) → telegramId = chat id, muvaffaqiyat", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567" },
    ]);
    // ulashgan raqam `+` siz keladi — normalizatsiya mos qilishi kerak.
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { telegramId: "999" },
    });
    // muvaffaqiyat javobi (ism bilan)
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("Ali");
  });

  it("mos telefon topilmadi → заявка на доступ (PENDING), аккаунт НЕ трогаем", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567" },
    ]);
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998900000000" }),
      makeDeps(),
    );

    // Аккаунт не создаётся/не привязывается — только заявка.
    expect(update).not.toHaveBeenCalled();
    expect(tarUpsert).toHaveBeenCalledTimes(1);
    const arg = tarUpsert.mock.calls[0][0] as {
      where: { telegramId: string };
      create: { telegramId: string; phone: string | null };
      update: { status: string };
    };
    expect(arg.where.telegramId).toBe("999");
    expect(arg.create.telegramId).toBe("999");
    expect(arg.create.phone).toBe("998900000000");
    expect(arg.update.status).toBe("PENDING");
    // Пользователю — «заявка отправлена, ждите одобрения».
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("Заявка на доступ отправлена");
  });

  it("заявка + OWNER'ы с Telegram → всем OWNER'ам приходит push с magic-link на /accounts", async () => {
    findMany.mockResolvedValue([]); // ни один аккаунт не совпал
    findOwnersWithTelegram.mockResolvedValue([
      { id: "owner1", telegramId: "111" },
      { id: "owner2", telegramId: "222" },
    ]);
    signMagicLinkToken.mockResolvedValue("MAGIC");

    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998900000000" }),
      makeDeps(),
    );

    // 1 сообщение заявителю + по одному каждому OWNER'у = 3.
    expect(sendMessage).toHaveBeenCalledTimes(3);
    const targets = sendMessage.mock.calls.map((c) => c[0]);
    expect(targets).toContain(999); // заявителю
    expect(targets).toContain("111");
    expect(targets).toContain("222");
    const ownerMsg = sendMessage.mock.calls.find((c) => c[0] === "111")?.[1] as string;
    expect(ownerMsg).toContain("Новая заявка");
    expect(ownerMsg).toContain("998900000000");
    expect(ownerMsg).toContain("https://onyx.test/login/tg?token=MAGIC&next=%2Faccounts");
  });

  it("заявка + OWNER'ов нет → OWNER-уведомлений нет, заявка отправлена", async () => {
    findMany.mockResolvedValue([]);
    findOwnersWithTelegram.mockResolvedValue([]);

    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998900000000" }),
      makeDeps(),
    );

    expect(tarUpsert).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1); // только заявителю
  });

  it("sendMessage OWNER'у падает → заявка всё равно создана, ошибка проглочена", async () => {
    findMany.mockResolvedValue([]);
    findOwnersWithTelegram.mockResolvedValue([{ id: "o1", telegramId: "111" }]);
    signMagicLinkToken.mockResolvedValue("MAGIC");
    // Первый вызов (заявителю) — ok; второй (OWNER'у) — throw.
    sendMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("tg down"));

    await expect(
      handleUpdate(contactUpdate({ chatId: 999, phone: "998900000000" }), makeDeps()),
    ).resolves.toBeUndefined();

    expect(tarUpsert).toHaveBeenCalledTimes(1);
  });

  it("forward qilingan kontakt (contact.user_id !== from.id) → bog'lanmaydi", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567" },
    ]);
    await handleUpdate(
      contactUpdate({
        chatId: 999,
        fromId: 999,
        contactUserId: 123, // boshqa odamning kontakti
        phone: "998901234567",
      }),
      makeDeps(),
    );

    expect(update).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled(); // guard oldin ishlaydi
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("не найден");
  });

  it("contact.user_id yo'q (user_id undefined) → bog'lanmaydi", async () => {
    await handleUpdate(
      contactUpdate({ chatId: 999, contactUserId: undefined, phone: "998901234567" }),
      makeDeps(),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("bir xil raqam 2 yozuvda (format farqi) → noaniq, bog'lanmaydi", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567" },
      { id: "u2", name: "Vali", phone: "998901234567" },
    ]);
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );
    expect(update).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("несколько");
  });

  it("telegramId @unique to'qnashuvi (P2002) → soqov emas, xabar beriladi", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567" },
    ]);
    update.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("уже");
  });

  it("faol bo'lmagan userlar findMany where'da filtrlanadi (isActive: true)", async () => {
    findMany.mockResolvedValue([]);
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, phone: { not: null } },
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });
});

// ── Foto update yasovchisi (TG-B2 / §5.5b caption bilan) ──
function photoUpdate(opts?: {
  chatId?: number;
  fileIds?: string[];
  caption?: string;
  replyToMessageId?: number;
}): TgUpdate {
  const chatId = opts?.chatId ?? 555;
  const fileIds = opts?.fileIds ?? ["small_id", "large_id"];
  return {
    update_id: 5,
    message: {
      message_id: 20,
      from: { id: chatId },
      chat: { id: chatId },
      // Telegram o'sish tartibida beradi — oxirgisi eng katta.
      photo: fileIds.map((file_id, i) => ({
        file_id,
        file_unique_id: `u_${file_id}`,
        width: 100 * (i + 1),
        height: 100 * (i + 1),
      })),
      ...(opts?.caption !== undefined ? { caption: opts.caption } : {}),
      // §5.3 — skladchi bot yuborgan vazifa xabariga reply qilgan bo'lsa.
      ...(opts?.replyToMessageId !== undefined
        ? {
            reply_to_message: {
              message_id: opts.replyToMessageId,
              chat: { id: chatId },
            },
          }
        : {}),
    },
  };
}

const PENDING_REQUEST = {
  id: "req1",
  status: "PENDING",
  managerId: "mgr1",
  batchId: "b1",
  slabId: null,
  batch: { stoneTypeId: "st1", stoneType: { name: "Оникс" } },
  batchLocation: { block: "А", landmark: "2" },
};

describe("получение фото (TG-B2)", () => {
  it("ТЗ №3 — фото УЗОР-запроса (batchPatternId) → Photo на узор (SAMPLE), плита НЕ создаётся, запрос DONE", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue({
      ...PENDING_REQUEST,
      batchPatternId: "pat1",
      slabId: null,
    });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Плита НЕ создаётся (узор — не отдельная плита).
    expect(separateSlabMock).not.toHaveBeenCalled();
    // Photo привязано к узору: SAMPLE + batchPatternId, без slabId.
    expect(photoCreate).toHaveBeenCalledTimes(1);
    const data = photoCreate.mock.calls[0][0].data;
    expect(data.kind).toBe("SAMPLE");
    expect(data.batchPatternId).toBe("pat1");
    expect(data.slabId).toBeNull();
    // Запрос закрыт одним фото (DONE).
    expect(prUpdate).toHaveBeenCalledTimes(1);
    expect(prUpdate.mock.calls[0][0].data.status).toBe("DONE");
  });

  it("§4.1 L3 / §6.1 — bog'langan skladchi + PENDING zapros → separateSlab чақирилади (вход верный) + Photo YANGI plita id'ga bog'lanadi; zapros PENDING QOLADI", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    separateSlabMock.mockResolvedValue("slabNew");
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, fileIds: ["small_id", "mid_id", "large_id"] }),
      makeDeps(),
    );

    // Выделение делегировано deps.separateSlab с верным входом: batch/stoneType/
    // photoRequest/separatedBy + локация из запроса (needsCheck=false). Транзакция,
    // batch-lock и guard §3 — уже внутри slab-separation.ts (свой тест). Нумерация
    // «Плита №N» тоже там (webhook больше её не считает).
    expect(separateSlabMock).toHaveBeenCalledTimes(1);
    expect(separateSlabMock.mock.calls[0][0]).toMatchObject({
      batchId: "b1",
      stoneTypeId: "st1",
      block: "А",
      landmark: "2",
      needsCheck: false,
      photoRequestId: "req1",
      separatedById: "w1",
    });

    // Photo — eng KATTA (oxirgi) file_id bilan, YANGI slab id'ga bog'liq.
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(photoCreate.mock.calls[0][0]).toMatchObject({
      data: {
        storageKey: "large_id",
        kind: "SLAB",
        takenById: "w1",
        stoneTypeId: "st1",
        slabId: "slabNew",
        photoRequestId: "req1",
      },
    });

    // §6.1 — zapros BIRINCHI fotoda YOPILMAYDI (N plita to'plash uchun ochiq qoladi).
    // Yopishni menejer «Готово» hal qiladi — bu yerda status yangilanmaydi.

    // Skladchiga «сохранено» + menejerga bildirishnoma (2 ta sendMessage).
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toBe(999);
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
    expect(sendMessage.mock.calls[1][0]).toBe("12345");
    expect(sendMessage.mock.calls[1][1]).toContain("Оникс");
  });

  it("§6.1 — o'sha zaprosga YANGI foto → separateSlab яна чақирилади, Photo qайтган plita id'ga bog'lanadi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    separateSlabMock.mockResolvedValue("slab2");

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Каждое новое фото делегирует выделение (нумерацию «Плита №N» и guard §3
    // считает slab-separation.ts под row-lock — здесь только делегирование).
    expect(separateSlabMock).toHaveBeenCalledTimes(1);
    expect(photoCreate.mock.calls[0][0].data.slabId).toBe("slab2");
  });

  it("§4.1 L3 — QAYTA suratga olish (slabId to'la) → separateSlab чақирилмайди, foto mavjud plitaga bog'lanadi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue({ ...PENDING_REQUEST, slabId: "existingSlab" });
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Reshoot: выделение НЕ вызывается (плита уже есть).
    expect(separateSlabMock).not.toHaveBeenCalled();
    expect(photoCreate.mock.calls[0][0].data.slabId).toBe("existingSlab");
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("§5.3 — batchLocation YO'Q → separateSlab'га «?» placeholder + needsCheck=true узатилади (keyin joyni skladchi kiritadi)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue({ ...PENDING_REQUEST, batchLocation: null });
    separateSlabMock.mockResolvedValue("slabNoLoc");

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Webhook разрешает block/landmark/needsCheck из batchLocation и передаёт входом.
    expect(separateSlabMock.mock.calls[0][0]).toMatchObject({
      block: "?",
      landmark: "?",
      needsCheck: true,
    });
    expect(photoCreate.mock.calls[0][0].data.slabId).toBe("slabNoLoc");
  });

  it("noma'lum telegramId (findFirst → null) → Photo/Slab YO'Q, «ro'yxatda yo'q»", async () => {
    userFindFirst.mockResolvedValue(null);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(photoCreate).not.toHaveBeenCalled();
    expect(separateSlabMock).not.toHaveBeenCalled();
    expect(prFindFirst).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("нет в списке");
  });

  it("D3 — MANAGER (bog'langan, faol) → «faqat sklad», zapros egallanmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "m1", role: "MANAGER" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Hech qanday zapros topilmaydi, slab/foto saqlanmaydi.
    expect(prFindFirst).not.toHaveBeenCalled();
    expect(separateSlabMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("складчик");
  });

  it("D3 — PARTNER (bog'langan, faol) → «faqat sklad», zapros egallanmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "p1", role: "PARTNER" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(prFindFirst).not.toHaveBeenCalled();
    expect(separateSlabMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("складчик");
  });

  it("D3 — noma'lum/buzuq rol → deny-by-default, zapros egallanmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "x1", role: "SUPERADMIN" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(prFindFirst).not.toHaveBeenCalled();
    expect(separateSlabMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("складчик");
  });

  it("D3 — OWNER ham sklad huquqli → foto qabul qilinadi (happy path)", async () => {
    userFindFirst.mockResolvedValue({ id: "o1", role: "OWNER" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(separateSlabMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("PENDING zapros yo'q (findFirst → null) → Slab/Photo YO'Q, «faol foto-so'rov yo'q»", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(null);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(separateSlabMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("нет активного фото-запроса");
  });

  // ── §5.3 — reply-to bilan aniq fotozaprosga bog'lash (FIFO'dan ustun) ──
  const REPLY_REQUEST = {
    id: "req_reply",
    status: "PENDING",
    managerId: "mgr2",
    batchId: "b_reply",
    slabId: null,
    batch: { stoneTypeId: "st_reply", stoneType: { name: "Гранит" } },
    batchLocation: { block: "Б", landmark: "5" },
  };

  it("reply-to aniq vazifaga tushsa → foto AYNAN o'sha zaprosga (eski PENDING boshqa tosh bo'lsa ham)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    // reply qilingan xabar → PhotoDispatch → boshqa (yangiroq) zapros.
    pdFindFirst.mockResolvedValue({ photoRequestId: "req_reply" });
    prFindFirst.mockResolvedValue(REPLY_REQUEST);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, replyToMessageId: 4242 }),
      makeDeps(),
    );

    // PhotoDispatch aynan (chatId, reply message_id) bo'yicha qidirildi.
    expect(pdFindFirst).toHaveBeenCalledTimes(1);
    expect(pdFindFirst.mock.calls[0][0]).toMatchObject({
      where: { chatId: "999", messageId: 4242 },
    });

    // PhotoRequest FIFO OR-navbat bilan EMAS, aniq id bilan olindi (status
    // e'tiborga OLINMAYDI — §6.1: reply har doim o'z zaprosiga bog'lanadi).
    expect(prFindFirst).toHaveBeenCalledTimes(1);
    expect(prFindFirst.mock.calls[0][0].where).toMatchObject({ id: "req_reply" });
    expect(prFindFirst.mock.calls[0][0].where.OR).toBeUndefined();
    expect(prFindFirst.mock.calls[0][0].where.status).toBeUndefined();

    // Foto AYNAN reply qilingan zaprosga (va uning yangi slab'iga) biriktirildi.
    expect(separateSlabMock.mock.calls[0][0]).toMatchObject({
      batchId: "b_reply",
      stoneTypeId: "st_reply",
      photoRequestId: "req_reply",
    });
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(photoCreate.mock.calls[0][0].data).toMatchObject({
      photoRequestId: "req_reply",
      stoneTypeId: "st_reply",
    });
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("reply-to bo'lmagan bare foto → FIFO fallback (eski oqim o'zgarmaydi), pdFindFirst chaqirilmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // reply yo'q → PhotoDispatch qidirilmaydi, FIFO OR-navbat ishlaydi.
    expect(pdFindFirst).not.toHaveBeenCalled();
    expect(prFindFirst.mock.calls[0][0].where).toMatchObject({
      status: "PENDING",
    });
    expect(prFindFirst.mock.calls[0][0].where.OR).toBeDefined();
    expect(photoCreate.mock.calls[0][0].data.photoRequestId).toBe("req1");
  });

  it("reply-to begona xabarga (PhotoDispatch topilmadi) → FIFO fallback", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    pdFindFirst.mockResolvedValue(null); // reply tanish vazifa xabari EMAS.
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, replyToMessageId: 999999 }),
      makeDeps(),
    );

    expect(pdFindFirst).toHaveBeenCalledTimes(1);
    // Tanish vazifa emas → FIFO navbat ishlaydi (bare foto kabi).
    expect(prFindFirst.mock.calls[0][0].where.OR).toBeDefined();
    expect(photoCreate.mock.calls[0][0].data.photoRequestId).toBe("req1");
  });

  it("§6.1 — reply-to tanish vazifaga, zapros allaqachon DONE bo'lsa → RAD (Slab/Photo YO'Q), «zapros yopilgan» xabari", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    pdFindFirst.mockResolvedValue({ photoRequestId: "req_reply" });
    // reply-to lookup by-id (status'siz) → yopilgan (DONE) zapros ham topiladi.
    prFindFirst.mockResolvedValue({ ...REPLY_REQUEST, status: "DONE" });
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, replyToMessageId: 4242 }),
      makeDeps(),
    );

    // Faqat bitta prFindFirst (reply-to by-id), FIFO fallback ishlamaydi.
    expect(prFindFirst).toHaveBeenCalledTimes(1);
    expect(prFindFirst.mock.calls[0][0].where).toMatchObject({ id: "req_reply" });
    // Yopilgan zaprosga javob → yangi plita AJRATILMAYDI (inventar drift'i yo'q).
    expect(separateSlabMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    // Skladchiga zapros yopilgani aytiladi.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("закрыт");
  });

  it("reply-to tanish vazifa, lekin zapros o'chirilgan (by-id null) → FIFO'ga TUSHMAYDI, «so'rov yo'q»", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    pdFindFirst.mockResolvedValue({ photoRequestId: "req_reply" });
    prFindFirst.mockResolvedValue(null); // by-id lookup — zapros yo'q.

    await handleUpdate(
      photoUpdate({ chatId: 999, replyToMessageId: 4242 }),
      makeDeps(),
    );

    expect(prFindFirst).toHaveBeenCalledTimes(1);
    expect(separateSlabMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("нет активного фото-запроса");
  });

  it("menejerni xabardor qilish yiqilsa → throw QILMAYDI, skladchi baribir saqlandi+javob oldi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });
    // Menejerga yuborilgan (2-chi) sendMessage yiqiladi; skladchiga (1-chi) — OK.
    sendMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("tg down"));

    await expect(
      handleUpdate(photoUpdate({ chatId: 999 }), makeDeps()),
    ).resolves.toBeUndefined();

    // Slab + foto baribir saqlangan.
    expect(separateSlabMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).toHaveBeenCalledTimes(1);
    // Skladchi tasdiqni oldi.
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });
});

// ── §5.5b — singan tosh (rasm + «singan» izohi → AI-shakl → havola) ──
describe("singan tosh oqimi (§5.5b)", () => {
  it("rasm + «singan» izohi → yuklab olish, AI, /singan?d= havolasi; ESKI foto-oqim CHAQIRILMAYDI", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });

    await handleUpdate(
      photoUpdate({
        chatId: 999,
        fileIds: ["small_id", "large_id"],
        caption: "singan tosh",
      }),
      makeDeps(),
    );

    // Eng KATTA (oxirgi) file_id yuklab olinadi, AI chaqiriladi.
    expect(downloadPhotoBase64).toHaveBeenCalledTimes(1);
    expect(downloadPhotoBase64).toHaveBeenCalledWith("large_id");
    expect(analyzeShape).toHaveBeenCalledTimes(1);
    expect(analyzeShape).toHaveBeenCalledWith("QUJD", "image/jpeg");

    // Havola yuborildi va draft ROUND-TRIP dekodlanadi (vertices + file_id).
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const text = sendMessage.mock.calls[0][1] as string;
    expect(text).toContain("https://onyx.test/singan?d=");
    expect(text).toContain("4 стороны");
    const encoded = text.split("/singan?d=")[1].trim();
    expect(decodeShapeDraft(encoded)).toEqual({
      vertices: QUAD,
      fileId: "large_id",
    });

    // PhotoRequest oqimi umuman ishlamadi (marshrutlash to'g'ri).
    expect(prFindFirst).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("«Бой» (kirill, katta harf) izohi ham singan oqimiga tushadi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });

    await handleUpdate(
      photoUpdate({ chatId: 999, caption: "Бой камня" }),
      makeDeps(),
    );

    expect(analyzeShape).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("/singan?d=");
  });

  it("AI null (ishlamadi) → halol xabar (/razbit), havola YO'Q", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    analyzeShape.mockResolvedValue(null);

    await handleUpdate(photoUpdate({ chatId: 999, caption: "singan" }), makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("/razbit");
    expect(sendMessage.mock.calls[0][1]).not.toContain("?d=");
  });

  it("rasm yuklab olinmadi (null) → xabar, AI CHAQIRILMAYDI", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    downloadPhotoBase64.mockResolvedValue(null);

    await handleUpdate(photoUpdate({ chatId: 999, caption: "singan" }), makeDeps());

    expect(analyzeShape).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("Не удалось загрузить");
  });

  it("ro'yxatda yo'q yuboruvchi → «ro'yxatda yo'q», yuklab olish YO'Q", async () => {
    userFindFirst.mockResolvedValue(null);

    await handleUpdate(photoUpdate({ chatId: 999, caption: "singan" }), makeDeps());

    expect(downloadPhotoBase64).not.toHaveBeenCalled();
    expect(analyzeShape).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("нет в списке");
  });

  it("D3 — MANAGER (sklad emas) → «faqat sklad», yuklab olish/AI YO'Q", async () => {
    userFindFirst.mockResolvedValue({ id: "m1", role: "MANAGER" });

    await handleUpdate(photoUpdate({ chatId: 999, caption: "singan" }), makeDeps());

    expect(downloadPhotoBase64).not.toHaveBeenCalled();
    expect(analyzeShape).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("складчик");
    expect(sendMessage.mock.calls[0][1]).not.toContain("?d=");
  });

  it("D3 — noma'lum rol (deny-by-default) → «faqat sklad», AI YO'Q", async () => {
    userFindFirst.mockResolvedValue({ id: "x1", role: "GARBAGE" });

    await handleUpdate(photoUpdate({ chatId: 999, caption: "бой" }), makeDeps());

    expect(downloadPhotoBase64).not.toHaveBeenCalled();
    expect(analyzeShape).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("складчик");
  });

  it("appBaseUrl bo'sh → buzuq havola O'RNIGA aniq xabar, AI ham chaqirilmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });

    await handleUpdate(
      photoUpdate({ chatId: 999, caption: "singan" }),
      makeDeps({ appBaseUrl: "" }),
    );

    expect(analyzeShape).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).not.toContain("?d=");
    expect(sendMessage.mock.calls[0][1]).toContain("не удалось подготовить ссылку");
  });

  it("izohsiz rasm → ESKI PhotoRequest oqimi o'zgarishsiz (AI tegmaydi)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(downloadPhotoBase64).not.toHaveBeenCalled();
    expect(analyzeShape).not.toHaveBeenCalled();
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("boshqa izohli rasm («chiroyli tosh») ham eski oqimda qoladi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, caption: "chiroyli tosh" }),
      makeDeps(),
    );

    expect(analyzeShape).not.toHaveBeenCalled();
    expect(photoCreate).toHaveBeenCalledTimes(1);
  });

  it("/singan matn buyrug'i (rasmsiz) → yo'riqnoma xabari", async () => {
    await handleUpdate(loginUpdate(999, "/singan"), makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("бой");
    expect(downloadPhotoBase64).not.toHaveBeenCalled();
  });

  it("/singan@BotName ham yo'riqnoma beradi; /singanfoo — YO'Q", async () => {
    await handleUpdate(loginUpdate(999, "/singan@OnyxSkladBot"), makeDeps());
    expect(sendMessage).toHaveBeenCalledTimes(1);

    sendMessage.mockClear();
    await handleUpdate(loginUpdate(999, "/singanfoo"), makeDeps());
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ── /login (SK-4b) ──
function loginUpdate(chatId = 555, text = "/login"): TgUpdate {
  return {
    update_id: 6,
    message: {
      message_id: 30,
      from: { id: chatId },
      chat: { id: chatId },
      text,
    },
  };
}

describe("/login — magic-link (SK-4b)", () => {
  it("bog'langan telegramId → magic-link imzolanadi va URL yuboriladi", async () => {
    userFindFirst.mockResolvedValue({ id: "u1", role: "MANAGER" });

    await handleUpdate(loginUpdate(999), makeDeps());

    // Imzolovchi userId + kelajakdagi muddat (Number) bilan chaqirildi.
    expect(signMagicLinkToken).toHaveBeenCalledTimes(1);
    expect(signMagicLinkToken).toHaveBeenCalledWith("u1", expect.any(Number));
    const expiresAtMs = signMagicLinkToken.mock.calls[0][1] as number;
    expect(expiresAtMs).toBeGreaterThan(Date.now());

    // Foydalanuvchiga URL (base + token) yuborildi, DB yozuv YO'Q.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe(999);
    expect(sendMessage.mock.calls[0][1]).toContain(
      "https://onyx.test/login/tg?token=SIGNED_TOKEN",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("`/start login` deep-link ham login oqimini ishga tushiradi", async () => {
    userFindFirst.mockResolvedValue({ id: "u1", role: "WAREHOUSE" });

    await handleUpdate(loginUpdate(999, "/start login"), makeDeps());

    expect(signMagicLinkToken).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("SIGNED_TOKEN");
    // Kontakt-so'rov klaviaturasi YO'Q (bu /start onboarding emas).
    const opts = sendMessage.mock.calls[0][2];
    expect(opts).toBeUndefined();
  });

  it("noma'lum telegramId → «ro'yxatda yo'q», link YO'Q", async () => {
    userFindFirst.mockResolvedValue(null);

    await handleUpdate(loginUpdate(999), makeDeps());

    expect(signMagicLinkToken).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("нет в списке");
    expect(sendMessage.mock.calls[0][1]).not.toContain("token=");
  });

  it("token bo'sh (AUTH_COOKIE_SECRET yo'q) → buzuq havola O'RNIGA aniq xabar", async () => {
    userFindFirst.mockResolvedValue({ id: "u1", role: "WAREHOUSE" });
    signMagicLinkToken.mockResolvedValue(""); // imzo kaliti yo'q → bo'sh token.

    await handleUpdate(loginUpdate(999), makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    // Buzuq «/login/tg?token=» yuborilmaydi; o'rniga tushunarli xabar.
    expect(sendMessage.mock.calls[0][1]).not.toContain("token=");
    expect(sendMessage.mock.calls[0][1]).toContain("войти не удалось");
  });

  it("/loginfoo (yopishgan) → login deb qabul QILINMAYDI", async () => {
    await handleUpdate(loginUpdate(999, "/loginfoo"), makeDeps());
    expect(signMagicLinkToken).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("kutilmagan update'lar", () => {
  it("text ham, contact ham yo'q → e'tiborsiz, xatosiz", async () => {
    const upd: TgUpdate = {
      update_id: 3,
      message: { message_id: 12, chat: { id: 1 } },
    };
    await expect(handleUpdate(upd, makeDeps())).resolves.toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("message umuman yo'q → e'tiborsiz", async () => {
    await expect(
      handleUpdate({ update_id: 4 } as TgUpdate, makeDeps()),
    ).resolves.toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("handler ichida xato → reject QILMAYDI (webhook doim 200)", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    await expect(
      handleUpdate(contactUpdate({ phone: "998901234567" }), makeDeps()),
    ).resolves.toBeUndefined();
  });
});
