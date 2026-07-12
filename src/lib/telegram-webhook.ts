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
// Foto qabul qilish uchun kerakli PhotoRequest yozuvining minimal shakli.
interface PendingPhotoRequest {
  id: string;
  managerId: string;
  slabId: string | null;
  batch: { stoneTypeId: string; stoneType: { name: string } | null };
}

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
      // Foto oqimi (TG-B2): yuboruvchini telegramId bo'yicha topish.
      findFirst(args: {
        where: { telegramId: string; isActive: boolean };
        select: { id: true; role: true };
      }): Promise<{ id: string; role: string } | null>;
      // Menejerni xabardor qilish uchun telegramId'ni olish.
      findUnique(args: {
        where: { id: string };
        select: { telegramId: true };
      }): Promise<{ telegramId: string | null } | null>;
    };
    photoRequest: {
      // Skladchining eng eski PENDING zaprosini (umumiy navbat yoki o'ziga).
      findFirst(args: {
        where: {
          status: "PENDING";
          OR: Array<{ assigneeId: null } | { assigneeId: string }>;
        };
        orderBy: { createdAt: "asc" };
        include: {
          batch: {
            select: {
              stoneTypeId: true;
              stoneType: { select: { name: true } };
            };
          };
        };
      }): Promise<PendingPhotoRequest | null>;
      // ATOMIK «egallash» (S2-conc uslubi): faqat hali PENDING bo'lsa DONE qiladi.
      // count===1 → biz egalladik; count===0 → boshqa skladchi ulgurdi.
      updateMany(args: {
        where: { id: string; status: "PENDING" };
        data: { status: "DONE"; completedAt: Date };
      }): Promise<{ count: number }>;
    };
    photo: {
      create(args: {
        data: {
          storageKey: string;
          kind: "SLAB";
          takenAt: Date;
          takenById: string;
          stoneTypeId: string;
          slabId: string | null;
          photoRequestId: string;
        };
      }): Promise<unknown>;
    };
  };
  sendMessage(
    chatId: number | string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void>;
  // SK-4b: Telegram magic-link login. Handler'ni hermetik saqlash uchun
  // imzolovchi va bazaviy URL inyeksiya qilinadi (route real, testlar mock).
  // signMagicLinkToken — auth.ts'dagi sof HMAC imzolovchisi (DB YO'Q).
  signMagicLinkToken(userId: string, expiresAtMs: number): Promise<string>;
  // appBaseUrl — magic-link URL'ining bazasi, masalan `https://onyx.example`.
  appBaseUrl: string;
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

// Foto oqimi (TG-B2) matnlari — skladchi/menejer ruscha ko'radi.
const MSG_PHOTO_NOT_REGISTERED =
  "Siz ro'yxatda yo'qsiz. /start yuboring.";
const MSG_PHOTO_NO_REQUEST = "Hozircha faol foto-so'rov yo'q.";
const MSG_PHOTO_SAVED = "✅ Rasm saqlandi, rahmat!";
const managerNotifyMessage = (stoneTypeName: string) =>
  `📷 Rasm tayyor: ${stoneTypeName}.`;

// SK-4b login matnlari (o'zbekcha — skladchi ko'radi).
const MSG_LOGIN_NOT_REGISTERED =
  "Siz ro'yxatda yo'qsiz. Telefon raqamingizni bog'lash uchun /start yuboring.";
const loginLinkMessage = (url: string) =>
  `Kirish havolasi (2 daqiqa amal qiladi):\n${url}\nHavolani hech kimga yubormang.`;
// Sozlama yetishmasa (AUTH_COOKIE_SECRET yoki APP_BASE_URL yo'q) — buzuq havola
// o'rniga shu xabar. Skladchini chalg'itmaydi; sabab log'da qoladi.
const MSG_LOGIN_UNAVAILABLE =
  "Hozircha kirib bo'lmadi. Birozdan so'ng qayta urinib ko'ring yoki menejeringizga murojaat qiling.";

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

/**
 * `/login` login niyatini aniqlaydi (SK-4b). Ikki shakl:
 *  - to'g'ridan `/login` yoki `/login@BotName`;
 *  - deep-link: `t.me/<bot>?start=login` → Telegram `/start login` yuboradi.
 * `/loginfoo` kabi yopishgan matnga tegmaydi.
 */
function isLoginCommand(text: string): boolean {
  const parts = text.trim().split(/\s+/);
  const first = parts[0];
  if (first === "/login" || first.startsWith("/login@")) return true;
  if ((first === "/start" || first.startsWith("/start@")) && parts[1] === "login") {
    return true;
  }
  return false;
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

    // 2) Foto (TG-B2) → PENDING zaprosga biriktirish, DONE qilish, menejerni xabardor.
    if (Array.isArray(message.photo) && message.photo.length > 0) {
      await handlePhoto(message, deps);
      return;
    }

    // 3) /login (yoki `/start login` deep-link) → magic-link yuborish.
    //    /start dan OLDIN tekshiriladi (chunki `/start login` ikkalasiga ham mos).
    if (typeof message.text === "string" && isLoginCommand(message.text)) {
      await handleLogin(chatId, deps);
      return;
    }

    // 4) /start buyrug'i → kontakt so'rash klaviaturasi.
    if (typeof message.text === "string" && isStartCommand(message.text)) {
      await deps.sendMessage(chatId, MSG_ASK_CONTACT, {
        reply_markup: CONTACT_KEYBOARD,
      });
      return;
    }

    // 5) Boshqa har qanday update — e'tiborsiz (xatosiz qaytamiz).
  } catch (err) {
    // Webhook doim 200 qaytishi uchun xatoni yutamiz.
    console.error("[telegram-webhook] handleUpdate xatosi:", err);
  }
}

/**
 * `/login` oqimi (SK-4b). Bu Telegram chat'i faol foydalanuvchiga bog'langan
 * bo'lsa — 2 daqiqalik magic-link yuboriladi; aks holda «ro'yxatda yo'q» xabari.
 * DB YOZUV YO'Q: token stateless imzolangan (auth.signMagicLinkToken).
 *
 * ⚠️ Stateless token DB'siz haqiqiy bir-martalik bo'la olmaydi — 2 daqiqalik
 * qisqa muddat yumshatuvi (deps.signMagicLinkToken'ga now+ttl beriladi).
 */
async function handleLogin(chatId: number, deps: WebhookDeps): Promise<void> {
  const user = await deps.db.user.findFirst({
    where: { telegramId: String(chatId), isActive: true },
    select: { id: true, role: true },
  });
  if (!user) {
    await deps.sendMessage(chatId, MSG_LOGIN_NOT_REGISTERED);
    return;
  }
  const expiresAtMs = Date.now() + 2 * 60 * 1000; // 2 daqiqa.
  const token = await deps.signMagicLinkToken(user.id, expiresAtMs);
  // Himoya: token bo'sh (AUTH_COOKIE_SECRET yo'q) yoki bazaviy URL yo'q bo'lsa —
  // buzuq «/login/tg?token=» havolasi yuborilmasin. Aniq xabar beramiz.
  if (!token || !deps.appBaseUrl) {
    console.warn(
      "[telegram-webhook] /login: token yoki appBaseUrl bo'sh — env sozlanmagan (AUTH_COOKIE_SECRET / APP_BASE_URL).",
    );
    await deps.sendMessage(chatId, MSG_LOGIN_UNAVAILABLE);
    return;
  }
  const url = `${deps.appBaseUrl}/login/tg?token=${token}`;
  await deps.sendMessage(chatId, loginLinkMessage(url));
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

/**
 * Skladchi yuborgan fotoni qabul qiladi (TG-B2). Faqat bog'langan (telegramId,
 * isActive) foydalanuvchi topshira oladi. Foto eng eski PENDING zaprosga
 * biriktiriladi (umumiy navbat yoki o'ziga tayinlangan), zapros DONE bo'ladi,
 * menejer xabardor qilinadi. Rasm o'zi saqlanmaydi — Telegram file_id saqlanadi
 * (storageKey), keyin proksi orqali oqim bilan ko'rsatiladi.
 *
 * handleUpdate try/catch ichida — bu funksiya throw qilsa ham webhook 200 qaytadi.
 */
async function handlePhoto(
  message: NonNullable<TgUpdate["message"]>,
  deps: WebhookDeps,
): Promise<void> {
  const chatId = message.chat.id;

  // (1) Yuboruvchi bog'langan va faol bo'lishi shart.
  const user = await deps.db.user.findFirst({
    where: { telegramId: String(chatId), isActive: true },
    select: { id: true, role: true },
  });
  if (!user) {
    await deps.sendMessage(chatId, MSG_PHOTO_NOT_REGISTERED);
    return;
  }

  // (2) Eng katta o'lcham — massivning oxirgi elementi (Telegram o'sish tartibi).
  const photos = message.photo!;
  const largest = photos[photos.length - 1];

  // (3) PENDING zaprosni ATOMIK egallaymiz (S2-conc uslubi, ADR-007 ruhida).
  // Eng eski PENDING'ni topib, guarded updateMany bilan (id + status:PENDING → DONE)
  // egallaymiz. count===1 → biz oldik; count===0 → boshqa skladchi o'sha oniyda
  // egalladi, keyingi PENDING'ga o'tamiz. Shu bilan ikki skladchi bitta zaprosga
  // biriktirmaydi (poyga yopildi). Bound: 5 urinish (cheksiz sikl bo'lmasin).
  let claimed: PendingPhotoRequest | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const request = await deps.db.photoRequest.findFirst({
      where: {
        status: "PENDING",
        OR: [{ assigneeId: null }, { assigneeId: user.id }],
      },
      orderBy: { createdAt: "asc" },
      include: {
        batch: {
          select: { stoneTypeId: true, stoneType: { select: { name: true } } },
        },
      },
    });
    if (!request) break; // PENDING qolmadi.
    const res = await deps.db.photoRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "DONE", completedAt: new Date() },
    });
    if (res.count === 1) {
      claimed = request;
      break;
    }
    // count===0 — boshqa skladchi egalladi, keyingi PENDING'ni izlaymiz.
  }
  if (!claimed) {
    await deps.sendMessage(chatId, MSG_PHOTO_NO_REQUEST);
    return;
  }

  // (4) Photo yozuvi — storageKey = Telegram file_id (Blob yo'q). Zapros allaqachon
  // biz tomondan DONE qilingan; bu foto aynan shu zaprosga tegishli.
  // (Kamdan-kam qisman-xato: create yiqilsa, zapros DONE bo'lib foto yo'q qoladi —
  //  outer try/catch tutadi, skladchi javob olmaydi. Nadir; TG-C follow-up.)
  await deps.db.photo.create({
    data: {
      storageKey: largest.file_id,
      kind: "SLAB",
      takenAt: new Date(),
      takenById: user.id,
      stoneTypeId: claimed.batch.stoneTypeId,
      slabId: claimed.slabId ?? null,
      photoRequestId: claimed.id,
    },
  });

  // (5) Skladchiga tasdiq.
  await deps.sendMessage(chatId, MSG_PHOTO_SAVED);

  // (6) Menejerni xabardor qilamiz — ALOHIDA try/catch: bu yiqilsa skladchining
  // saqlash+javob oqimi buzilmasin.
  try {
    const manager = await deps.db.user.findUnique({
      where: { id: claimed.managerId },
      select: { telegramId: true },
    });
    if (manager?.telegramId) {
      const stoneName = claimed.batch.stoneType?.name ?? "tosh";
      await deps.sendMessage(
        manager.telegramId,
        managerNotifyMessage(stoneName),
      );
    }
  } catch (err) {
    console.error("[telegram-webhook] menejerni xabardor qilish xatosi:", err);
  }
}
