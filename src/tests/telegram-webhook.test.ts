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

function makeDeps(): WebhookDeps {
  return {
    db: {
      user: {
        findMany: (...a: unknown[]) => findMany(...a),
        update: (...a: unknown[]) => update(...a),
      },
    },
    sendMessage: (...a: unknown[]) => sendMessage(...a),
  } as unknown as WebhookDeps;
}

beforeEach(() => {
  findMany.mockReset();
  update.mockReset();
  sendMessage.mockReset();
  findMany.mockResolvedValue([]);
  update.mockResolvedValue({});
  sendMessage.mockResolvedValue(undefined);
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
