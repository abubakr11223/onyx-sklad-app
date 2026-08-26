// TG-A — telegram webhook sof handler testlari (real DB / real Telegram YO'Q).
// deps (db, sendMessage) inyeksiya qilinadi — mock uzatamiz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TgUpdate } from "@/lib/telegram";
import {
  handleUpdate,
  normalizePhone,
  phonesEqual,
  resolveImageDocument,
  resolveIncomingImage,
  unsupportedMediaReply,
  MAX_IMAGE_DOCUMENT_BYTES,
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
const prFindMany = vi.fn(); // bare-foto FIFO / disambiguation
const prUpdate = vi.fn(); // ТЗ №3 — узор-запрос закрывается (DONE)
const photoCreate = vi.fn();
// §4.1 L3 / §6.1 / W10-B — Slab+Photo atomik: deps.separateSlabWithPhoto.
const separateSlabWithPhotoMock = vi.fn();
// §5.3 — reply-to bo'yicha PhotoDispatch qidirish mock'i.
const pdFindFirst = vi.fn();
// SK-4b: magic-link imzolovchisi mock'i.
const tarUpsert = vi.fn(); // onboarding — заявка на доступ (upsert)
const signMagicLinkToken = vi.fn();
// §5.5b (singan tosh) mock'lari.
const downloadPhotoBase64 = vi.fn();
const analyzeShape = vi.fn();

// W9-D — default claim always "claimed" so existing tests keep processing.
const claimTelegramUpdate = vi.fn(
  async (_id: number): Promise<"claimed" | "already_seen" | "error"> =>
    "claimed",
);
// W10-B — release on domain fail (must not stay claimed).
const releaseTelegramUpdate = vi.fn(async (_id: number): Promise<boolean> => true);

/** Bridge vi.fn → WebhookDeps without illegal `...unknown[]` spread (TS2556). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callMock(fn: ReturnType<typeof vi.fn>, ...args: any[]): any {
  return fn(...args);
}

function makeDeps(overrides?: Partial<WebhookDeps>): WebhookDeps {
  return {
    db: {
      user: {
        findMany: (...a: unknown[]) => callMock(findMany, ...a),
        update: (...a: unknown[]) => callMock(update, ...a),
        findFirst: (...a: unknown[]) => callMock(userFindFirst, ...a),
        findUnique: (...a: unknown[]) => callMock(userFindUnique, ...a),
      },
      telegramAccessRequest: {
        upsert: (...a: unknown[]) => callMock(tarUpsert, ...a),
      },
      photoRequest: {
        findFirst: (...a: unknown[]) => callMock(prFindFirst, ...a),
        findMany: (...a: unknown[]) => callMock(prFindMany, ...a),
        update: (...a: unknown[]) => callMock(prUpdate, ...a),
      },
      photoDispatch: {
        findFirst: (...a: unknown[]) => callMock(pdFindFirst, ...a),
      },
      photo: {
        create: (...a: unknown[]) => callMock(photoCreate, ...a),
      },
    },
    sendMessage: (...a: unknown[]) => callMock(sendMessage, ...a),
    signMagicLinkToken: (...a: unknown[]) => callMock(signMagicLinkToken, ...a),
    appBaseUrl: "https://onyx.test",
    downloadPhotoBase64: (...a: unknown[]) =>
      callMock(downloadPhotoBase64, ...a),
    analyzeShape: (...a: unknown[]) => callMock(analyzeShape, ...a),
    separateSlabWithPhoto: (...a: unknown[]) =>
      callMock(separateSlabWithPhotoMock, ...a),
    claimTelegramUpdate: (id: number) => claimTelegramUpdate(id),
    releaseTelegramUpdate: (id: number) => releaseTelegramUpdate(id),
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
  prFindMany.mockReset();
  prUpdate.mockReset();
  photoCreate.mockReset();
  separateSlabWithPhotoMock.mockReset();
  pdFindFirst.mockReset();
  tarUpsert.mockReset();
  tarUpsert.mockResolvedValue({});
  findMany.mockResolvedValue([]);
  update.mockResolvedValue({});
  sendMessage.mockResolvedValue(undefined);
  userFindFirst.mockResolvedValue(null);
  userFindUnique.mockResolvedValue(null);
  prFindFirst.mockResolvedValue(null);
  prFindMany.mockResolvedValue([]);
  prUpdate.mockResolvedValue({});
  photoCreate.mockResolvedValue({});
  separateSlabWithPhotoMock.mockResolvedValue("slab1");
  pdFindFirst.mockResolvedValue(null);
  signMagicLinkToken.mockReset();
  signMagicLinkToken.mockResolvedValue("SIGNED_TOKEN");
  downloadPhotoBase64.mockReset();
  analyzeShape.mockReset();
  downloadPhotoBase64.mockResolvedValue({ base64: "QUJD", mediaType: "image/jpeg" });
  analyzeShape.mockResolvedValue({ sideCount: 4, vertices: QUAD });
  claimTelegramUpdate.mockReset();
  claimTelegramUpdate.mockResolvedValue("claimed");
  releaseTelegramUpdate.mockReset();
  releaseTelegramUpdate.mockResolvedValue(true);
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
  // W11-B: UZ milliy 9 raqam va 00-prefix — avval jim non-match edi.
  it("UZ 9-raqam (Telegram milliy) → 998… xalqaro", () => {
    expect(normalizePhone("901234567")).toBe("998901234567");
    expect(normalizePhone("90 123 45 67")).toBe("998901234567");
    expect(normalizePhone("90-123-45-67")).toBe("998901234567");
  });
  it("00-prefix xalqaro → 00 olib tashlanadi", () => {
    expect(normalizePhone("00998901234567")).toBe("998901234567");
  });
  it("ikki HAQIQIY turli raqam bir xil stringga tushmaydi", () => {
    expect(normalizePhone("998901234567")).not.toBe(
      normalizePhone("998901234568"),
    );
    // 8 raqam / boshqa uzunlik — 998 qo'shilmaydi
    expect(normalizePhone("90123456")).toBe("90123456");
    expect(normalizePhone("8901234567")).toBe("8901234567");
  });
});

describe("phonesEqual", () => {
  it("saqlangan +998… va Telegram 9-raqam bir xil", () => {
    expect(phonesEqual("+998 90 123-45-67", "901234567")).toBe(true);
    expect(phonesEqual("998901234567", "90 123 45 67")).toBe(true);
  });
  it("turli raqamlar → false; bo'sh → false", () => {
    expect(phonesEqual("998901234567", "998901234568")).toBe(false);
    expect(phonesEqual(null, "998901234567")).toBe(false);
    expect(phonesEqual("", "")).toBe(false);
  });
});

describe("/start — kontakt so'rovi", () => {
  it("request_contact klaviaturasi bilan javob, DB yozuv YO'Q", async () => {
    await handleUpdate(startUpdate(777), makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = sendMessage.mock.calls[0];
    expect(chatId).toBe(777);
    expect(typeof text).toBe("string");
    // W11-B: aniq yo'riqnoma — tugma + nima bo'lishi.
    expect(text).toContain("Поделиться номером");
    expect(text).toContain("привязк");
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

  it("/startfoo (yopishgan) → /start deb qabul QILINMAYDI (yo'riqnoma, jimlik YO'Q)", async () => {
    const upd = startUpdate(777);
    upd.message!.text = "/startfoo";
    await handleUpdate(upd, makeDeps());
    // Buyruq deb qabul qilinmaydi (kontakt klaviaturasi yo'q), lekin jim emas.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/Onyx bot|фото|\/start/i);
    expect(sendMessage.mock.calls[0][2]?.reply_markup).toBeUndefined();
  });
});

describe("kontakt → foydalanuvchini bog'lash", () => {
  it("mos telefon (saqlangan +998 vs ulashgan 998) → telegramId = chat id, muvaffaqiyat", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567", telegramId: null },
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

  it("W11-B: saqlangan +998… vs Telegram 9-raqam milliy → bog'lanadi (jim non-match yo'q)", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567", telegramId: null },
    ]);
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "901234567" }),
      makeDeps(),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { telegramId: "999" },
    });
    expect(tarUpsert).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("Ali");
  });

  it("mos telefon topilmadi → заявка на доступ (PENDING), аккаунт НЕ трогаем", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567", telegramId: null },
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

  it("forward qilingan kontakt (contact.user_id !== from.id) → bog'lanmaydi", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567", telegramId: null },
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
    // W11-B: aniq «o'z raqamingiz» (oldingi soqov «не найден» emas).
    expect(sendMessage.mock.calls[0][1]).toContain("собственный");
  });

  it("contact.user_id yo'q (user_id undefined) → bog'lanmaydi", async () => {
    await handleUpdate(
      contactUpdate({ chatId: 999, contactUserId: undefined, phone: "998901234567" }),
      makeDeps(),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("bir xil raqam 2 yozuvda → noaniq, bog'lanmaydi + owner PENDING ariza", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567", telegramId: null },
      { id: "u2", name: "Vali", phone: "998901234567", telegramId: null },
    ]);
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );
    expect(update).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("несколько");
    // W11-B: owner /accounts da ko'rsin (worker-only dead-end emas).
    expect(tarUpsert).toHaveBeenCalledTimes(1);
    const arg = tarUpsert.mock.calls[0][0] as {
      create: { name: string | null; phone: string | null };
      update: { status: string };
    };
    expect(arg.create.name).toContain("⚠");
    expect(arg.create.name).toContain("Ali");
    expect(arg.create.name).toContain("Vali");
    expect(arg.create.phone).toBe("998901234567");
    expect(arg.update.status).toBe("PENDING");
  });

  it("telegramId @unique race (P2002, holder topilmagan) → worker xabar + owner PENDING", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567", telegramId: null },
    ]);
    // findFirst holder topmadi (race: boshqa TX o'rtada yozdi).
    userFindFirst.mockResolvedValue(null);
    update.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/уже привязан|конфликт/i);
    expect(tarUpsert).toHaveBeenCalledTimes(1);
    const arg = tarUpsert.mock.calls[0][0] as {
      create: { name: string | null };
      update: { status: string };
    };
    expect(arg.create.name).toContain("⚠");
    expect(arg.create.name).toMatch(/Конфликт|конфликт/i);
    expect(arg.update.status).toBe("PENDING");
  });

  it("W11-B reclaim: chat demo skladda → holder tozalanadi, match bog'lanadi, owner biladi", async () => {
    // Ownerning TG chat'i demo WAREHOUSE qatorida; real ishchi o'z telefoni bilan keladi.
    findMany.mockResolvedValue([
      {
        id: "demo-wh",
        name: "Demo Sklad",
        phone: "+998900000001",
        telegramId: "999",
      },
      {
        id: "real-wh",
        name: "Real Worker",
        phone: "+998901234567",
        telegramId: null,
      },
    ]);
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "demo-wh" },
      data: { telegramId: null },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "real-wh" },
      data: { telegramId: "999" },
    });
    expect(sendMessage.mock.calls[0][1]).toContain("Real Worker");
    expect(sendMessage.mock.calls[0][1]).toContain("Demo Sklad");
    expect(tarUpsert).toHaveBeenCalledTimes(1);
    const arg = tarUpsert.mock.calls[0][0] as {
      create: { name: string | null; phone: string | null };
    };
    expect(arg.create.name).toContain("⚠");
    expect(arg.create.name).toContain("перепривязан");
    expect(arg.create.name).toContain("Demo Sklad");
    expect(arg.create.name).toContain("Real Worker");
  });

  it("W11-B reclaim: holder faqat findFirst orqali (inactive / phonesiz, findMany da yo'q)", async () => {
    findMany.mockResolvedValue([
      {
        id: "real-wh",
        name: "Real Worker",
        phone: "+998901234567",
        telegramId: null,
      },
    ]);
    userFindFirst.mockResolvedValue({
      id: "stale-demo",
      name: "Stale Demo",
      phone: null,
      telegramId: "999",
      role: "WAREHOUSE",
    });
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { telegramId: "999" },
      }),
    );
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "stale-demo" },
      data: { telegramId: null },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "real-wh" },
      data: { telegramId: "999" },
    });
  });

  it("allaqachon shu chat shu akkauntda → update YO'Q, success", async () => {
    findMany.mockResolvedValue([
      {
        id: "u1",
        name: "Ali",
        phone: "+998901234567",
        telegramId: "999",
      },
    ]);
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );
    expect(update).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("Ali");
  });

  it("bir xil akkaunt boshqa chatga qayta bog'lanadi (o'z telegramId almashtirish)", async () => {
    findMany.mockResolvedValue([
      {
        id: "u1",
        name: "Ali",
        phone: "+998901234567",
        telegramId: "111", // eski chat
      },
    ]);
    userFindFirst.mockResolvedValue(null); // yangi chat bo'sh
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998901234567" }),
      makeDeps(),
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { telegramId: "999" },
    });
    // Boshqa akkauntdan o'g'irish emas — owner notice shart emas.
    expect(tarUpsert).not.toHaveBeenCalled();
  });

  it("chatni boshqa akkauntdan jim o'g'irmaydi: telefon isbotisiz update YO'Q (forward guard)", async () => {
    // Xavfsizlik: begona kontakt bilan boshqa userning chatini tortib bo'lmaydi.
    findMany.mockResolvedValue([
      {
        id: "victim",
        name: "Victim",
        phone: "+998901111111",
        telegramId: "999",
      },
      {
        id: "attacker",
        name: "Attacker",
        phone: "+998902222222",
        telegramId: null,
      },
    ]);
    await handleUpdate(
      contactUpdate({
        chatId: 999,
        fromId: 999,
        contactUserId: 123, // begona kontakt
        phone: "998902222222",
      }),
      makeDeps(),
    );
    expect(update).not.toHaveBeenCalled();
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
        select: expect.objectContaining({ telegramId: true }),
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
  /** Distinct per delivery — defaults to 5 for single-photo tests. */
  updateId?: number;
  messageId?: number;
  /** Album: shared across several updates. */
  mediaGroupId?: string;
}): TgUpdate {
  const chatId = opts?.chatId ?? 555;
  const fileIds = opts?.fileIds ?? ["small_id", "large_id"];
  return {
    update_id: opts?.updateId ?? 5,
    message: {
      message_id: opts?.messageId ?? 20,
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
      ...(opts?.mediaGroupId !== undefined
        ? { media_group_id: opts.mediaGroupId }
        : {}),
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

/** Document (Send as File) update — rasm yoki boshqa fayl. */
function documentUpdate(opts?: {
  chatId?: number;
  fileId?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  replyToMessageId?: number;
  updateId?: number;
  messageId?: number;
}): TgUpdate {
  const chatId = opts?.chatId ?? 555;
  const fileId = opts?.fileId ?? "doc_file_id";
  return {
    update_id: opts?.updateId ?? 50,
    message: {
      message_id: opts?.messageId ?? 50,
      from: { id: chatId },
      chat: { id: chatId },
      document: {
        file_id: fileId,
        file_unique_id: `u_${fileId}`,
        ...(opts?.mimeType !== undefined ? { mime_type: opts.mimeType } : {}),
        ...(opts?.fileName !== undefined ? { file_name: opts.fileName } : {}),
        ...(opts?.fileSize !== undefined ? { file_size: opts.fileSize } : {}),
      },
      ...(opts?.caption !== undefined ? { caption: opts.caption } : {}),
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
    prFindMany.mockResolvedValue([
      {
        ...PENDING_REQUEST,
        batchPatternId: "pat1",
        slabId: null,
      },
    ]);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Плита НЕ создаётся (узор — не отдельная плита).
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
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
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock.mockResolvedValue("slabNew");
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, fileIds: ["small_id", "mid_id", "large_id"] }),
      makeDeps(),
    );

    // Выделение делегировано deps.separateSlabWithPhoto с верным входом: batch/stoneType/
    // photoRequest/separatedBy + локация из запроса (needsCheck=false). Транзакция,
    // batch-lock и guard §3 — уже внутри slab-separation.ts (свой тест). Нумерация
    // «Плита №N» тоже там (webhook больше её не считает).
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(separateSlabWithPhotoMock.mock.calls[0][0]).toMatchObject({
      batchId: "b1",
      stoneTypeId: "st1",
      block: "А",
      landmark: "2",
      needsCheck: false,
      photoRequestId: "req1",
      separatedById: "w1",
    });
    // W10-B — Photo.SLAB eng katta file_id bilan SHU atomik chaqiruvda (alohida
    // photo.create yo'q — partial fail teshigi yopilgan).
    expect(separateSlabWithPhotoMock.mock.calls[0][1]).toMatchObject({
      storageKey: "large_id",
      takenById: "w1",
    });
    expect(photoCreate).not.toHaveBeenCalled();

    // §6.1 — zapros BIRINCHI fotoda YOPILMAYDI (N plita to'plash uchun ochiq qoladi).
    // Yopishni menejer «Готово» hal qiladi — bu yerda status yangilanmaydi.

    // Skladchiga «сохранено» + menejerga bildirishnoma (2 ta sendMessage).
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toBe(999);
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
    expect(sendMessage.mock.calls[1][0]).toBe("12345");
    expect(sendMessage.mock.calls[1][1]).toContain("Оникс");
  });

  it("§6.1 — o'sha zaprosga YANGI foto → separateSlabWithPhoto yana chaqiriladi (atomik Photo)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock.mockResolvedValue("slab2");

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Каждое новое фото делегирует выделение+фото (нумерацию «Плита №N» и guard §3
    // считает slab-separation.ts под row-lock — здесь только делегирование).
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("§4.1 L3 — QAYTA suratga olish (slabId to'la) → separateSlab чақирилмайди, foto mavjud plitaga bog'lanadi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([
      { ...PENDING_REQUEST, slabId: "existingSlab" },
    ]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Reshoot: выделение НЕ вызывается (плита уже есть).
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate.mock.calls[0][0].data.slabId).toBe("existingSlab");
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("§5.3 — batchLocation YO'Q → separateSlab'га «?» placeholder + needsCheck=true узатилади (keyin joyni skladchi kiritadi)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([
      { ...PENDING_REQUEST, batchLocation: null },
    ]);
    separateSlabWithPhotoMock.mockResolvedValue("slabNoLoc");

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Webhook разрешает block/landmark/needsCheck из batchLocation и передаёт входом.
    expect(separateSlabWithPhotoMock.mock.calls[0][0]).toMatchObject({
      block: "?",
      landmark: "?",
      needsCheck: true,
    });
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("noma'lum telegramId (findFirst → null) → Photo/Slab YO'Q, «ro'yxatda yo'q»", async () => {
    userFindFirst.mockResolvedValue(null);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(photoCreate).not.toHaveBeenCalled();
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(prFindFirst).not.toHaveBeenCalled();
    expect(prFindMany).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("нет в списке");
  });

  it("D3 — MANAGER (bog'langan, faol) → «faqat sklad», zapros egallanmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "m1", role: "MANAGER" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // Hech qanday zapros topilmaydi, slab/foto saqlanmaydi.
    expect(prFindFirst).not.toHaveBeenCalled();
    expect(prFindMany).not.toHaveBeenCalled();
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("складчик");
  });

  it("D3 — PARTNER (bog'langan, faol) → «faqat sklad», zapros egallanmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "p1", role: "PARTNER" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(prFindFirst).not.toHaveBeenCalled();
    expect(prFindMany).not.toHaveBeenCalled();
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("складчик");
  });

  it("D3 — noma'lum/buzuq rol → deny-by-default, zapros egallanmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "x1", role: "SUPERADMIN" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(prFindFirst).not.toHaveBeenCalled();
    expect(prFindMany).not.toHaveBeenCalled();
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("складчик");
  });

  it("D3 — OWNER ham sklad huquqli → foto qabul qilinadi (happy path)", async () => {
    userFindFirst.mockResolvedValue({ id: "o1", role: "OWNER" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("PENDING zapros yo'q (findMany → []) → Slab/Photo YO'Q, «faol foto-so'rov yo'q»", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([]);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
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

    // Foto AYNAN reply qilingan zaprosga (atomik separateSlabWithPhoto).
    expect(separateSlabWithPhotoMock.mock.calls[0][0]).toMatchObject({
      batchId: "b_reply",
      stoneTypeId: "st_reply",
      photoRequestId: "req_reply",
    });
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("reply-to bo'lmagan bare foto → FIFO fallback (eski oqim o'zgarmaydi), pdFindFirst chaqirilmaydi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    // reply yo'q → PhotoDispatch qidirilmaydi, FIFO OR-navbat (findMany) ishlaydi.
    expect(pdFindFirst).not.toHaveBeenCalled();
    expect(prFindMany).toHaveBeenCalledTimes(1);
    expect(prFindMany.mock.calls[0][0].where).toMatchObject({
      status: "PENDING",
    });
    expect(prFindMany.mock.calls[0][0].where.OR).toBeDefined();
    expect(separateSlabWithPhotoMock.mock.calls[0][0].photoRequestId).toBe(
      "req1",
    );
  });

  it("reply-to begona xabarga (PhotoDispatch topilmadi) → FIFO fallback", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    pdFindFirst.mockResolvedValue(null); // reply tanish vazifa xabari EMAS.
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, replyToMessageId: 999999 }),
      makeDeps(),
    );

    expect(pdFindFirst).toHaveBeenCalledTimes(1);
    // Tanish vazifa emas → findMany navbat ishlaydi (bare foto kabi).
    expect(prFindMany).toHaveBeenCalledTimes(1);
    expect(prFindMany.mock.calls[0][0].where.OR).toBeDefined();
    expect(separateSlabWithPhotoMock.mock.calls[0][0].photoRequestId).toBe(
      "req1",
    );
  });

  // ── Audit 3.1 — bare foto disambiguation (2+ PENDING) ──
  const PENDING_B = {
    id: "req2",
    status: "PENDING" as const,
    managerId: "mgr1",
    batchId: "b2",
    slabId: null,
    batchPatternId: null,
    batch: { stoneTypeId: "st2", stoneType: { name: "Мрамор" } },
    batchLocation: { block: "В", landmark: "7" },
  };

  it("Audit 3.1 — 1 PENDING + bare foto → biriktiriladi (FIFO tez yo'l, regressiya yo'q)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([{ ...PENDING_REQUEST, batchPatternId: null }]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(prFindMany).toHaveBeenCalledTimes(1);
    expect(prFindFirst).not.toHaveBeenCalled();
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(separateSlabWithPhotoMock.mock.calls[0][0].photoRequestId).toBe(
      "req1",
    );
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("Audit 3.1 — 2 PENDING + bare foto → biriktirilMAYDI + ochiq so'rovlar ro'yxati (reply so'rash)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([
      { ...PENDING_REQUEST, batchPatternId: null },
      PENDING_B,
    ]);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(prFindMany).toHaveBeenCalledTimes(1);
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const text = sendMessage.mock.calls[0][1] as string;
    expect(text).toContain("несколько фото-запросов");
    expect(text).toMatch(/reply/i);
    // Ro'yxatda ikkala batch/tosh nomi.
    expect(text).toContain("Оникс");
    expect(text).toContain("Мрамор");
    expect(text).toContain("блок А");
    expect(text).toContain("блок В");
  });

  it("Audit 3.1 — 2 PENDING + reply foto → reply-first ishlaydi (findMany CHAQIRILMAYDI)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    // 2+ ochiq bo'lsa ham reply aniq zaprosga bog'laydi.
    pdFindFirst.mockResolvedValue({ photoRequestId: "req_reply" });
    prFindFirst.mockResolvedValue({ ...REPLY_REQUEST, batchPatternId: null });
    prFindMany.mockResolvedValue([
      { ...PENDING_REQUEST, batchPatternId: null },
      PENDING_B,
    ]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, replyToMessageId: 4242 }),
      makeDeps(),
    );

    expect(pdFindFirst).toHaveBeenCalledTimes(1);
    expect(prFindFirst).toHaveBeenCalledTimes(1);
    expect(prFindFirst.mock.calls[0][0].where).toMatchObject({ id: "req_reply" });
    // Bare disambiguation ishlamaydi — reply yo'li.
    expect(prFindMany).not.toHaveBeenCalled();
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(separateSlabWithPhotoMock.mock.calls[0][0].photoRequestId).toBe(
      "req_reply",
    );
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
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
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
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
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("нет активного фото-запроса");
  });

  it("menejerni xabardor qilish yiqilsa → throw QILMAYDI, skladchi baribir saqlandi+javob oldi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });
    // Menejerga yuborilgan (2-chi) sendMessage yiqiladi; skladchiga (1-chi) — OK.
    sendMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("tg down"));

    await expect(
      handleUpdate(photoUpdate({ chatId: 999 }), makeDeps()),
    ).resolves.toBeUndefined();

    // Slab + foto baribir saqlangan (atomik withPhoto).
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).not.toHaveBeenCalled();
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
    expect(prFindMany).not.toHaveBeenCalled();
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
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(downloadPhotoBase64).not.toHaveBeenCalled();
    expect(analyzeShape).not.toHaveBeenCalled();
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("boshqa izohli rasm («chiroyli tosh») ham eski oqimda qoladi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, caption: "chiroyli tosh" }),
      makeDeps(),
    );

    expect(analyzeShape).not.toHaveBeenCalled();
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("/singan matn buyrug'i (rasmsiz) → yo'riqnoma xabari", async () => {
    await handleUpdate(loginUpdate(999, "/singan"), makeDeps());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("бой");
    expect(downloadPhotoBase64).not.toHaveBeenCalled();
  });

  it("/singan@BotName ham yo'riqnoma beradi; /singanfoo — buyruq emas (yo'riqnoma)", async () => {
    await handleUpdate(loginUpdate(999, "/singan@OnyxSkladBot"), makeDeps());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("бой");

    sendMessage.mockClear();
    await handleUpdate(loginUpdate(999, "/singanfoo"), makeDeps());
    // /singan deb qabul qilinmaydi; jim emas — umumiy yo'riqnoma.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/Onyx bot|фото|\/start/i);
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

  it("/loginfoo (yopishgan) → login deb qabul QILINMAYDI (yo'riqnoma, jimlik YO'Q)", async () => {
    await handleUpdate(loginUpdate(999, "/loginfoo"), makeDeps());
    expect(signMagicLinkToken).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/Onyx bot|фото|\/start/i);
  });
});

describe("kutilmagan update'lar", () => {
  it("text ham, contact ham yo'q → yo'riqnoma (jimlik YO'Q), xatosiz", async () => {
    const upd: TgUpdate = {
      update_id: 3,
      message: { message_id: 12, chat: { id: 1 } },
    };
    await expect(handleUpdate(upd, makeDeps())).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/Onyx bot|фото/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("message umuman yo'q → e'tiborsiz (chat yo'q)", async () => {
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

// ── W9-D — update_id idempotency + album (media_group_id) ──

describe("W9-D update_id idempotency", () => {
  it("same update_id replayed → claim already_seen → no second separateSlabWithPhoto/Photo", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock.mockResolvedValue("slabNew");

    const upd = photoUpdate({
      chatId: 999,
      updateId: 9001,
      fileIds: ["a", "b"],
    });
    // First delivery claims and processes.
    claimTelegramUpdate.mockResolvedValueOnce("claimed");
    await handleUpdate(upd, makeDeps());
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).not.toHaveBeenCalled();
    expect(releaseTelegramUpdate).not.toHaveBeenCalled();

    // Telegram retry: same update_id, already_seen → full domain no-op.
    claimTelegramUpdate.mockResolvedValueOnce("already_seen");
    await handleUpdate(upd, makeDeps());
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).not.toHaveBeenCalled();
    expect(claimTelegramUpdate).toHaveBeenCalledWith(9001);
  });

  it("claim error (receipt DB down) → fail-open still processes once", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock.mockResolvedValue("slabErr");
    claimTelegramUpdate.mockResolvedValueOnce("error");

    await handleUpdate(photoUpdate({ chatId: 999, updateId: 77 }), makeDeps());
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    // fail-open: claim === "error" → claimedUpdateId not set → no release
    expect(releaseTelegramUpdate).not.toHaveBeenCalled();
  });
});

// ── W10-B — Slab+Photo atomik; partial fail + receipt release ──

describe("W10-B separateSlabWithPhoto atomicity + receipt release", () => {
  it("photo path fails inside separateSlabWithPhoto → release claimed update_id", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    // Simulates TX rollback (e.g. photo.create threw inside withPhoto).
    separateSlabWithPhotoMock.mockRejectedValue(new Error("photo create failed"));
    claimTelegramUpdate.mockResolvedValueOnce("claimed");

    await handleUpdate(
      photoUpdate({ chatId: 999, updateId: 4242 }),
      makeDeps(),
    );

    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    // Sharp edge: without release, retry would be already_seen and photo lost.
    expect(releaseTelegramUpdate).toHaveBeenCalledWith(4242);
    // No orphan path via separate photo.create
    expect(photoCreate).not.toHaveBeenCalled();
  });

  // Регрессия: партия исчерпана — складчик ДОЛЖЕН получить ответ.
  // Раньше SlabSeparationError улетала в общий catch: claim освобождался,
  // Telegram повторял тот же update, и человек не видел ни ✅, ни ошибки.
  it("INSUFFICIENT_REMAINDER → понятное сообщение, claim НЕ освобождается", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    const err = Object.assign(new Error("В партии не осталось свободных плит"), {
      code: "INSUFFICIENT_REMAINDER",
    });
    separateSlabWithPhotoMock.mockRejectedValue(err);
    claimTelegramUpdate.mockResolvedValueOnce("claimed");

    await handleUpdate(photoUpdate({ chatId: 999, updateId: 7001 }), makeDeps());

    const texts = sendMessage.mock.calls.map((c) => String(c[1]));
    expect(texts.some((t) => t.includes("не осталось свободных плит"))).toBe(true);
    expect(texts.some((t) => t.includes("✅"))).toBe(false);
    // Повтор ничего не исправит — claim остаётся, цикла повторов нет.
    expect(releaseTelegramUpdate).not.toHaveBeenCalled();
  });

  it("BATCH_NOT_FOUND → тоже отвечаем, а не молчим", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock.mockRejectedValue(
      Object.assign(new Error("Партия не найдена"), { code: "BATCH_NOT_FOUND" }),
    );
    claimTelegramUpdate.mockResolvedValueOnce("claimed");

    await handleUpdate(photoUpdate({ chatId: 999, updateId: 7002 }), makeDeps());

    const texts = sendMessage.mock.calls.map((c) => String(c[1]));
    expect(texts.some((t) => t.includes("Фото не сохранено"))).toBe(true);
    expect(releaseTelegramUpdate).not.toHaveBeenCalled();
  });

  it("success → claim kept (release NOT called) so replay is no-op", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock.mockResolvedValue("slabOk");
    claimTelegramUpdate.mockResolvedValueOnce("claimed");

    await handleUpdate(
      photoUpdate({ chatId: 999, updateId: 5151 }),
      makeDeps(),
    );

    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(releaseTelegramUpdate).not.toHaveBeenCalled();
  });

  it("2+ PENDING bare photo still rejects (05ba2a3) — no separateSlabWithPhoto", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([
      PENDING_REQUEST,
      { ...PENDING_REQUEST, id: "req2" },
    ]);
    claimTelegramUpdate.mockResolvedValueOnce("claimed");

    await handleUpdate(photoUpdate({ chatId: 999, updateId: 88 }), makeDeps());

    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toMatch(/несколько/i);
  });
});

describe("W9-D album (media_group_id) — traced behaviour", () => {
  it("3 album updates + 1 PENDING → 3 separateSlabWithPhoto (multi-slab §6.1; not only first)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock
      .mockResolvedValueOnce("s1")
      .mockResolvedValueOnce("s2")
      .mockResolvedValueOnce("s3");

    const group = "album-xyz";
    for (let i = 0; i < 3; i++) {
      claimTelegramUpdate.mockResolvedValueOnce("claimed");
      await handleUpdate(
        photoUpdate({
          chatId: 999,
          updateId: 100 + i,
          messageId: 200 + i,
          mediaGroupId: group,
          fileIds: [`f${i}_s`, `f${i}_l`],
        }),
        makeDeps(),
      );
    }
    // Each album member is its own update — all attach when disambiguation allows.
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(3);
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("album does NOT bypass 2+ PENDING disambiguation (each bare photo rejected)", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([
      PENDING_REQUEST,
      { ...PENDING_REQUEST, id: "req2", batchId: "b2" },
    ]);

    const group = "album-ambig";
    for (let i = 0; i < 2; i++) {
      claimTelegramUpdate.mockResolvedValueOnce("claimed");
      await handleUpdate(
        photoUpdate({
          chatId: 999,
          updateId: 300 + i,
          messageId: 400 + i,
          mediaGroupId: group,
        }),
        makeDeps(),
      );
    }
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    // Ambiguous list sent per photo (existing 05ba2a3 behaviour).
    expect(sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Image document (Send as File) + never-silent media ──

describe("resolveImageDocument / resolveIncomingImage (pure)", () => {
  it("jpeg/png/webp → ok fileId", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/jpg"]) {
      const r = resolveImageDocument({
        file_id: "f1",
        file_unique_id: "u1",
        mime_type: mime,
        file_size: 1000,
      });
      expect(r).toEqual({ ok: true, fileId: "f1", source: "document" });
    }
  });

  it("HEIC by mime or extension → reject with HEIC reply", () => {
    const byMime = resolveImageDocument({
      file_id: "h1",
      file_unique_id: "u",
      mime_type: "image/heic",
    });
    expect(byMime.ok).toBe(false);
    if (!byMime.ok) expect(byMime.reply).toMatch(/HEIC/i);

    const byName = resolveImageDocument({
      file_id: "h2",
      file_unique_id: "u",
      file_name: "IMG_0001.HEIC",
    });
    expect(byName.ok).toBe(false);
    if (!byName.ok) expect(byName.reply).toMatch(/HEIC|Фото/i);
  });

  it("non-image document (pdf) → reject", () => {
    const r = resolveImageDocument({
      file_id: "p1",
      file_unique_id: "u",
      mime_type: "application/pdf",
      file_name: "doc.pdf",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reply).toMatch(/не является фото|jpeg|png/i);
  });

  it("oversized image document → reject with size limit", () => {
    const r = resolveImageDocument({
      file_id: "big",
      file_unique_id: "u",
      mime_type: "image/jpeg",
      file_size: MAX_IMAGE_DOCUMENT_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reply).toMatch(/слишком большой|МБ/i);
  });

  it("photo[] preferred over document; empty → null", () => {
    const withPhoto = resolveIncomingImage({
      message_id: 1,
      chat: { id: 1 },
      photo: [
        {
          file_id: "small",
          file_unique_id: "us",
          width: 10,
          height: 10,
        },
        {
          file_id: "large",
          file_unique_id: "ul",
          width: 100,
          height: 100,
        },
      ],
    });
    expect(withPhoto).toEqual({
      ok: true,
      fileId: "large",
      source: "photo",
    });

    expect(
      resolveIncomingImage({ message_id: 1, chat: { id: 1 }, text: "hi" }),
    ).toBeNull();
  });

  it("unsupportedMediaReply covers video/voice/sticker/animation", () => {
    expect(
      unsupportedMediaReply({
        message_id: 1,
        chat: { id: 1 },
        video: { file_id: "v" },
      }),
    ).toMatch(/Видео/i);
    expect(
      unsupportedMediaReply({
        message_id: 1,
        chat: { id: 1 },
        voice: { file_id: "vo" },
      }),
    ).toMatch(/Голосовые|аудио/i);
    expect(
      unsupportedMediaReply({
        message_id: 1,
        chat: { id: 1 },
        sticker: { file_id: "s" },
      }),
    ).toMatch(/Стикер/i);
    expect(
      unsupportedMediaReply({ message_id: 1, chat: { id: 1 }, text: "x" }),
    ).toBeNull();
  });
});

describe("image document attaches like photo", () => {
  it("image/jpeg document + 1 PENDING → separateSlabWithPhoto with document file_id", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock.mockResolvedValue("slabDoc");
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      documentUpdate({
        chatId: 999,
        fileId: "doc_jpeg_id",
        mimeType: "image/jpeg",
        fileName: "slab.jpg",
        fileSize: 500_000,
      }),
      makeDeps(),
    );

    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(separateSlabWithPhotoMock.mock.calls[0][1]).toMatchObject({
      storageKey: "doc_jpeg_id",
      takenById: "w1",
    });
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("image/png document + reshoot (slabId set) → photo.create storageKey = file_id", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([
      { ...PENDING_REQUEST, slabId: "existingSlab" },
    ]);

    await handleUpdate(
      documentUpdate({
        chatId: 999,
        fileId: "png_id",
        mimeType: "image/png",
        fileSize: 1000,
      }),
      makeDeps(),
    );

    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate.mock.calls[0][0].data.storageKey).toBe("png_id");
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
  });

  it("non-image document (pdf) → refused WITH reply; no Photo/Slab", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);

    await handleUpdate(
      documentUpdate({
        chatId: 999,
        fileId: "pdf1",
        mimeType: "application/pdf",
        fileName: "a.pdf",
      }),
      makeDeps(),
    );

    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(prFindMany).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/не является фото|jpeg|png/i);
  });

  it("oversized jpeg document → refused WITH reply; no attach", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);

    await handleUpdate(
      documentUpdate({
        chatId: 999,
        fileId: "huge",
        mimeType: "image/jpeg",
        fileSize: MAX_IMAGE_DOCUMENT_BYTES + 1,
      }),
      makeDeps(),
    );

    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(prFindMany).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/слишком большой|МБ/i);
  });

  it("HEIC document → refused WITH resend-as-photo reply", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);

    await handleUpdate(
      documentUpdate({
        chatId: 999,
        fileId: "heic1",
        mimeType: "image/heic",
        fileName: "IMG.HEIC",
      }),
      makeDeps(),
    );

    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/HEIC|Фото/i);
  });

  it("2+ PENDING bare image document → multi-pending rule (05ba2a3), no attach", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([
      PENDING_REQUEST,
      { ...PENDING_REQUEST, id: "req2", batchId: "b2" },
    ]);

    await handleUpdate(
      documentUpdate({
        chatId: 999,
        fileId: "doc_ambig",
        mimeType: "image/jpeg",
        fileSize: 1000,
      }),
      makeDeps(),
    );

    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(photoCreate).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toMatch(/несколько/i);
  });

  it("replayed update_id for image document → no double-attach", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindMany.mockResolvedValue([PENDING_REQUEST]);
    separateSlabWithPhotoMock.mockResolvedValue("slabR");

    const upd = documentUpdate({
      chatId: 999,
      fileId: "doc_replay",
      mimeType: "image/webp",
      fileSize: 2000,
      updateId: 7777,
    });

    claimTelegramUpdate.mockResolvedValueOnce("claimed");
    await handleUpdate(upd, makeDeps());
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);

    claimTelegramUpdate.mockResolvedValueOnce("already_seen");
    await handleUpdate(upd, makeDeps());
    expect(separateSlabWithPhotoMock).toHaveBeenCalledTimes(1);
    expect(photoCreate).not.toHaveBeenCalled();
    expect(claimTelegramUpdate).toHaveBeenCalledWith(7777);
  });

  it("video message → refuse WITH reply (never silent)", async () => {
    const upd: TgUpdate = {
      update_id: 60,
      message: {
        message_id: 60,
        from: { id: 999 },
        chat: { id: 999 },
        video: { file_id: "vid1" },
      },
    };
    await handleUpdate(upd, makeDeps());
    expect(separateSlabWithPhotoMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/Видео/i);
  });

  it("sticker → refuse WITH reply", async () => {
    const upd: TgUpdate = {
      update_id: 61,
      message: {
        message_id: 61,
        chat: { id: 999 },
        sticker: { file_id: "st1" },
      },
    };
    await handleUpdate(upd, makeDeps());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toMatch(/Стикер/i);
  });
});
