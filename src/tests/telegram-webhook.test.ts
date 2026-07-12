// TG-A — telegram webhook sof handler testlari (real DB / real Telegram YO'Q).
// deps (db, sendMessage) inyeksiya qilinadi — mock uzatamiz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TgUpdate } from "@/lib/telegram";
import {
  handleUpdate,
  normalizePhone,
  type WebhookDeps,
} from "@/lib/telegram-webhook";

// ── Mock deps ──
const findMany = vi.fn();
const update = vi.fn();
const sendMessage = vi.fn();
// TG-B2 (foto) uchun qo'shimcha mock'lar.
const userFindFirst = vi.fn();
const userFindUnique = vi.fn();
const prFindFirst = vi.fn();
const prUpdateMany = vi.fn();
const photoCreate = vi.fn();
// SK-4b: magic-link imzolovchisi mock'i.
const signMagicLinkToken = vi.fn();

function makeDeps(): WebhookDeps {
  return {
    db: {
      user: {
        findMany: (...a: unknown[]) => findMany(...a),
        update: (...a: unknown[]) => update(...a),
        findFirst: (...a: unknown[]) => userFindFirst(...a),
        findUnique: (...a: unknown[]) => userFindUnique(...a),
      },
      photoRequest: {
        findFirst: (...a: unknown[]) => prFindFirst(...a),
        updateMany: (...a: unknown[]) => prUpdateMany(...a),
      },
      photo: {
        create: (...a: unknown[]) => photoCreate(...a),
      },
    },
    sendMessage: (...a: unknown[]) => sendMessage(...a),
    signMagicLinkToken: (...a: unknown[]) => signMagicLinkToken(...a),
    appBaseUrl: "https://onyx.test",
  } as unknown as WebhookDeps;
}

beforeEach(() => {
  findMany.mockReset();
  update.mockReset();
  sendMessage.mockReset();
  userFindFirst.mockReset();
  userFindUnique.mockReset();
  prFindFirst.mockReset();
  prUpdateMany.mockReset();
  photoCreate.mockReset();
  findMany.mockResolvedValue([]);
  update.mockResolvedValue({});
  sendMessage.mockResolvedValue(undefined);
  userFindFirst.mockResolvedValue(null);
  userFindUnique.mockResolvedValue(null);
  prFindFirst.mockResolvedValue(null);
  prUpdateMany.mockResolvedValue({ count: 1 });
  photoCreate.mockResolvedValue({});
  signMagicLinkToken.mockReset();
  signMagicLinkToken.mockResolvedValue("SIGNED_TOKEN");
});

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

  it("mos telefon topilmadi → DB yozuv YO'Q, xushmuomala javob", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ali", phone: "+998901234567" },
    ]);
    await handleUpdate(
      contactUpdate({ chatId: 999, phone: "998900000000" }),
      makeDeps(),
    );

    expect(update).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("topilmadi");
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
    expect(sendMessage.mock.calls[0][1]).toContain("topilmadi");
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
    expect(sendMessage.mock.calls[0][1]).toContain("bir nechta");
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
    expect(sendMessage.mock.calls[0][1]).toContain("allaqachon");
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

// ── Foto update yasovchisi (TG-B2) ──
function photoUpdate(opts?: {
  chatId?: number;
  fileIds?: string[];
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
    },
  };
}

const PENDING_REQUEST = {
  id: "req1",
  managerId: "mgr1",
  slabId: null,
  batch: { stoneTypeId: "st1", stoneType: { name: "Оникс" } },
};

describe("получение фото (TG-B2)", () => {
  it("bog'langan skladchi + PENDING zapros → Photo yaratiladi, DONE, skladchi+menejer xabardor", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(PENDING_REQUEST);
    userFindUnique.mockResolvedValue({ telegramId: "12345" });

    await handleUpdate(
      photoUpdate({ chatId: 999, fileIds: ["small_id", "mid_id", "large_id"] }),
      makeDeps(),
    );

    // Photo — eng KATTA (oxirgi) file_id bilan, zaprosga va stoneType'ga bog'liq.
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(photoCreate.mock.calls[0][0]).toMatchObject({
      data: {
        storageKey: "large_id",
        kind: "SLAB",
        takenById: "w1",
        stoneTypeId: "st1",
        slabId: null,
        photoRequestId: "req1",
      },
    });

    // Zapros ATOMIK egallandi: guarded updateMany (id + status:PENDING → DONE).
    expect(prUpdateMany).toHaveBeenCalledTimes(1);
    expect(prUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "req1", status: "PENDING" },
      data: { status: "DONE" },
    });
    expect(prUpdateMany.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);

    // Skladchiga «сохранено» + menejerga bildirishnoma (2 ta sendMessage).
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toBe(999);
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
    expect(sendMessage.mock.calls[1][0]).toBe("12345");
    expect(sendMessage.mock.calls[1][1]).toContain("Оникс");
  });

  it("noma'lum telegramId (findFirst → null) → Photo YO'Q, «не зарегистрированы»", async () => {
    userFindFirst.mockResolvedValue(null);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(photoCreate).not.toHaveBeenCalled();
    expect(prFindFirst).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("не зарегистрированы");
  });

  it("PENDING zapros yo'q (findFirst → null) → Photo YO'Q, «нет активных запросов»", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    prFindFirst.mockResolvedValue(null);

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(photoCreate).not.toHaveBeenCalled();
    expect(prUpdateMany).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("нет активных запросов");
  });

  it("poyga: birinchi zaprosni boshqa skladchi egalladi (count=0) → keyingisiga o'tadi", async () => {
    userFindFirst.mockResolvedValue({ id: "w1", role: "WAREHOUSE" });
    // 1-urinish: req1 topiladi, ammo egallash count=0 (boshqa ulgurdi).
    // 2-urinish: req2 topiladi, egallash count=1.
    prFindFirst
      .mockResolvedValueOnce({ ...PENDING_REQUEST, id: "req1" })
      .mockResolvedValueOnce({ ...PENDING_REQUEST, id: "req2" });
    prUpdateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await handleUpdate(photoUpdate({ chatId: 999 }), makeDeps());

    expect(prUpdateMany).toHaveBeenCalledTimes(2);
    // Foto AYNAN req2 ga biriktirildi (req1 emas — poyga to'g'ri yopildi).
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(photoCreate.mock.calls[0][0].data.photoRequestId).toBe("req2");
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
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

    // Saqlash + DONE baribir bo'lgan.
    expect(photoCreate).toHaveBeenCalledTimes(1);
    expect(prUpdateMany).toHaveBeenCalledTimes(1);
    // Skladchi tasdiqni oldi.
    expect(sendMessage.mock.calls[0][1]).toContain("сохранено");
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

  it("noma'lum telegramId → «не зарегистрированы», link YO'Q", async () => {
    userFindFirst.mockResolvedValue(null);

    await handleUpdate(loginUpdate(999), makeDeps());

    expect(signMagicLinkToken).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain("не зарегистрированы");
    expect(sendMessage.mock.calls[0][1]).not.toContain("token=");
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
