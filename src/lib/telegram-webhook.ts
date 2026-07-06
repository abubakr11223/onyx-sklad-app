// Telegram webhook update handler'i (TG-A) — SOF va testlanadigan.
// db va sendMessage inyeksiya qilinadi (deps) — bu yerda import QILINMAYDI,
// route real bog'lamalarni uzatadi, testlar mock uzatadi.
//
// TG-A doirasi: /start onboarding + kontakt orqali telefon bog'lash.
// Fotozapros oqimi (TG-B) — bu yerda YO'Q.

import type {
  SendMessageOptions,
  TgReplyKeyboardMarkup,
  TgUpdate,
} from "@/lib/telegram";

// ───────────────────────── Deps (inyeksiya) ─────────────────────────

// db'dan bizga faqat User bo'yicha 2 amal kerak. Prisma'ning to'liq tipini
// talab qilmaymiz — testlar oson mock qilishi uchun minimal shakl.
export interface WebhookDeps {
  db: {
    user: {
      findMany(args: {
        where: { isActive: boolean; phone: { not: null } };
        select: { id: true; name: true; phone: true };
      }): Promise<Array<{ id: string; name: string; phone: string | null }>>;
      update(args: {
        where: { id: string };
        data: { telegramId: string };
      }): Promise<unknown>;
    };
  };
  sendMessage(
    chatId: number | string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void>;
}

// ───────────────────────── Matnlar (uz/ru) ─────────────────────────

const MSG_ASK_CONTACT =
  "Onyx bot. Ro'yxatdan o'tish uchun telefon raqamingizni ulashing.";
const MSG_NOT_FOUND =
  "Telefon raqamingiz ro'yxatda topilmadi. Menejeringizga murojaat qiling.";
const MSG_AMBIGUOUS =
  "Raqamingiz bo'yicha bir nechta yozuv topildi. Menejeringizga murojaat qiling.";
const MSG_ALREADY_LINKED =
  "Bu Telegram akkaunt allaqachon boshqa foydalanuvchiga bog'langan. Menejeringizga murojaat qiling.";
const MSG_TRY_LATER = "Xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.";
const successMessage = (name: string) =>
  `Ro'yxatdan o'tdingiz, ${name}. Endi fotozaproslar shu yerga keladi.`;

// request_contact klaviaturasi — telefonni bir tugma bilan ulashish.
const CONTACT_KEYBOARD: TgReplyKeyboardMarkup = {
  keyboard: [[{ text: "📱 Telefonni ulashish", request_contact: true }]],
  one_time_keyboard: true,
  resize_keyboard: true,
};

// ───────────────────────── Yordamchilar ─────────────────────────

/**
 * Telefon raqamini FAQAT raqamlarga keltiradi: `+`, bo'shliq, tire, qavslar
 * olib tashlanadi. `+998 90 123-45-67` → `998901234567`. Solishtirish shu
 * normal shakl ustida bo'ladi (saqlangan `+998…` ham, ulashgan `998…` ham mos).
 */
export function normalizePhone(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\D+/g, "");
}

/**
 * `/start` buyrug'ini aniqlaydi. Birinchi so'z aynan `/start` yoki
 * `/start@BotName` bo'lsa true. `/startfoo` kabi yopishgan matnga tegmaydi.
 */
function isStartCommand(text: string): boolean {
  const first = text.trim().split(/\s+/)[0];
  return first === "/start" || first.startsWith("/start@");
}

// ───────────────────────── Handler ─────────────────────────

/**
 * Bitta Telegram update'ini qayta ishlaydi. HECH QACHON throw qilmaydi —
 * webhook auth o'tgach doim 200 qaytishi kerak (aks holda Telegram cheksiz
 * qayta uradi). Ichki xatolar tutiladi va loglanadi.
 */
export async function handleUpdate(
  update: TgUpdate,
  deps: WebhookDeps,
): Promise<void> {
  try {
    const message = update.message ?? update.edited_message;
    if (!message) return; // callback_query va h.k. — TG-A da e'tiborsiz.

    const chatId = message.chat.id;

    // 1) Kontakt ulashildi → telefon bo'yicha User topib bog'lash.
    if (message.contact) {
      await handleContact(message.contact, message.from?.id, chatId, deps);
      return;
    }

    // 2) /start buyrug'i → kontakt so'rash klaviaturasi.
    if (typeof message.text === "string" && isStartCommand(message.text)) {
      await deps.sendMessage(chatId, MSG_ASK_CONTACT, {
        reply_markup: CONTACT_KEYBOARD,
      });
      return;
    }

    // 3) Boshqa har qanday update — e'tiborsiz (xatosiz qaytamiz).
  } catch (err) {
    // Webhook doim 200 qaytishi uchun xatoni yutamiz.
    console.error("[telegram-webhook] handleUpdate xatosi:", err);
  }
}

async function handleContact(
  contact: NonNullable<TgUpdate["message"]>["contact"],
  fromId: number | undefined,
  chatId: number,
  deps: WebhookDeps,
): Promise<void> {
  if (!contact) return;

  // Guard: faqat foydalanuvchining O'Z kontakti bog'lanadi (forward emas).
  // contact.user_id — kontakt egasi; from.id — xabar yuboruvchi.
  if (contact.user_id == null || fromId == null || contact.user_id !== fromId) {
    await deps.sendMessage(chatId, MSG_NOT_FOUND);
    return;
  }

  const wanted = normalizePhone(contact.phone_number);
  if (!wanted) {
    await deps.sendMessage(chatId, MSG_NOT_FOUND);
    return;
  }

  // Faol, telefonli userlarni olib, normal shakl bo'yicha solishtiramiz
  // (saqlangan telefon formati har xil bo'lishi mumkin: `+998…`, `998…`).
  const users = await deps.db.user.findMany({
    where: { isActive: true, phone: { not: null } },
    select: { id: true, name: true, phone: true },
  });

  const matches = users.filter((u) => normalizePhone(u.phone) === wanted);

  if (matches.length === 0) {
    await deps.sendMessage(chatId, MSG_NOT_FOUND);
    return; // DB yozuvi YO'Q.
  }
  if (matches.length > 1) {
    // Bir xil raqam bir nechta yozuvda (format farqi) — noaniq, tasodifiy
    // birini tanlamaymiz; qo'lda hal qilinsin.
    await deps.sendMessage(chatId, MSG_AMBIGUOUS);
    return;
  }
  const match = matches[0];

  try {
    await deps.db.user.update({
      where: { id: match.id },
      data: { telegramId: String(chatId) },
    });
  } catch (err) {
    // telegramId @unique: bu chat allaqachon boshqa userga bog'langan → P2002.
    const code = (err as { code?: string })?.code;
    await deps.sendMessage(
      chatId,
      code === "P2002" ? MSG_ALREADY_LINKED : MSG_TRY_LATER,
    );
    return;
  }
  await deps.sendMessage(chatId, successMessage(match.name), {
    reply_markup: { remove_keyboard: true },
  });
}
