// Telegram webhook update handler'i (TG-A) — SOF va testlanadigan.
// db va sendMessage inyeksiya qilinadi (deps) — bu yerda import QILINMAYDI,
// route real bog'lamalarni uzatadi, testlar mock uzatadi.
//
// TG-A doirasi: /start onboarding + kontakt orqali telefon bog'lash.
// Fotozapros oqimi (TG-B) — bu yerda YO'Q.

import type {
  SendMessageOptions,
  SendResult,
  TgReplyKeyboardMarkup,
  TgUpdate,
} from "@/lib/telegram";
import { encodeShapeDraft } from "@/lib/singan";
import { capabilitiesFor, type Role } from "@/lib/permissions";
import type { SeparateSlabInput } from "@/lib/slab-separation";

// ───────────────────────── Deps (inyeksiya) ─────────────────────────

// db'dan bizga faqat User bo'yicha 2 amal kerak. Prisma'ning to'liq tipini
// talab qilmaymiz — testlar oson mock qilishi uchun minimal shakl.
// Foto qabul qilish uchun kerakli PhotoRequest yozuvining minimal shakli.
// §4.1 L3 / §6.1 — ajratilgan Slab yaratish uchun batchId + batchLocation ham kerak.
interface PendingPhotoRequest {
  id: string;
  // §6.1 — zapros holati. Prisma `include` bilan birga barcha skalyar maydonlarni
  // (shu jumladan `status`) qaytaradi. Reply-to yopilgan (DONE/CANCELLED) zaprosga
  // tushganda yangi Slab yaratmaslik uchun kerak (aks holda cheksiz inventar drift).
  status: "PENDING" | "DONE" | "CANCELLED";
  managerId: string;
  batchId: string;
  slabId: string | null; // null = yangi ajratish; to'la = mavjud plitani QAYTA suratga olish
  batchPatternId: string | null; // ТЗ №3 — узор-подгруппа (не плита) uchun so'rov
  batch: { stoneTypeId: string; stoneType: { name: string } | null };
  // Tanlangan lokatsiya (bo'lsa) → yangi Slab shu blok/orientirni oladi va darhol
  // sotiladigan bo'ladi (needsCheck=false). Yo'q bo'lsa — «?» placeholder + needsCheck.
  batchLocation: { block: string; landmark: string } | null;
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
    // Onboarding — заявка на доступ через Telegram. Телефон не привязан ни к
    // одному аккаунту → создаём/обновляем PENDING-заявку (владелец одобрит в /accounts).
    telegramAccessRequest: {
      upsert(args: {
        where: { telegramId: string };
        create: {
          telegramId: string;
          name: string | null;
          username: string | null;
          phone: string | null;
        };
        update: {
          name: string | null;
          username: string | null;
          phone: string | null;
          status: string;
        };
      }): Promise<unknown>;
    };
    photoRequest: {
      // §5.3 reply-to: AYNAN o'sha zapros (id). Status e'tiborga OLINMAYDI —
      // §6.1 bo'yicha bir zapros N plita to'playdi; yopilgani alohida rad etiladi.
      findFirst(args: {
        where: { id: string };
        include: {
          batch: {
            select: {
              stoneTypeId: true;
              stoneType: { select: { name: true } };
            };
          };
          batchLocation: { select: { block: true; landmark: true } };
        };
      }): Promise<PendingPhotoRequest | null>;
      // Bare-foto disambiguation: ochiq (PENDING) zaproslar (umumiy navbat yoki
      // shu skladchiga). 0 → yo'q; 1 → FIFO biriktir; 2+ → biriktirmay, reply so'ra.
      findMany(args: {
        where: {
          status: "PENDING";
          OR: Array<{ assigneeId: null } | { assigneeId: string }>;
        };
        orderBy?: { createdAt: "asc" };
        include: {
          batch: {
            select: {
              stoneTypeId: true;
              stoneType: { select: { name: true } };
            };
          };
          batchLocation: { select: { block: true; landmark: true } };
        };
      }): Promise<PendingPhotoRequest[]>;
      // ТЗ №3 — узор-запрос закрывается ОДНИМ фото (DONE).
      update(args: {
        where: { id: string };
        data: { status: "DONE"; completedAt: Date };
      }): Promise<unknown>;
    };
    // §5.3 — reply-to bo'yicha fotozaprosni topish: skladchi bot yuborgan vazifa
    // xabariga reply qilgan foto o'sha xabarning message_id'sini olib keladi.
    photoDispatch: {
      findFirst(args: {
        where: { chatId: string; messageId: number };
        select: { photoRequestId: true };
      }): Promise<{ photoRequestId: string } | null>;
    };
    photo: {
      create(args: {
        data: {
          storageKey: string;
          kind: "SLAB" | "SAMPLE";
          takenAt: Date;
          takenById: string;
          stoneTypeId: string;
          slabId: string | null;
          batchPatternId?: string | null;
          photoRequestId: string;
        };
      }): Promise<unknown>;
    };
  };
  // BUG-04: sendMessage endi SendResult qaytaradi (yetkazildi/xato). Webhook
  // oqimi natijani ISHLATMAYDI, shuning uchun void | SendResult — real klient
  // (SendResult) ham, testlar mock'i (undefined) ham mos keladi.
  sendMessage(
    chatId: number | string,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<void | SendResult>;
  // SK-4b: Telegram magic-link login. Handler'ni hermetik saqlash uchun
  // imzolovchi va bazaviy URL inyeksiya qilinadi (route real, testlar mock).
  // signMagicLinkToken — auth.ts'dagi sof HMAC imzolovchisi (DB YO'Q).
  signMagicLinkToken(userId: string, expiresAtMs: number): Promise<string>;
  // appBaseUrl — magic-link URL'ining bazasi, masalan `https://onyx.example`.
  appBaseUrl: string;
  // §5.5b — singan tosh oqimi. Handler hermetik qolsin deb rasmni yuklab olish
  // va AI-shakl aniqlash ham INYEKSIYA qilinadi (route real, testlar mock).
  // Rasm baytlari → base64 + media turi; xatoda null (fail-closed).
  downloadPhotoBase64(
    fileId: string,
  ): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" } | null>;
  // AI shakl-aniqlash (ai-shape.analyzeBrokenStoneShape); xatoda null.
  analyzeShape(
    imageBase64: string,
    mediaType: "image/jpeg" | "image/png",
  ): Promise<{ sideCount: number; vertices: { x: number; y: number }[] } | null>;
  // §4.1 L3 / §6.1 — выделение «Плиты №N» (+ Photo.SLAB, W10-B atomik).
  // Транзакция с batch-lock'ом и guard'ом остатка §3 + photo.create bir TX
  // (slab-separation.separateSlabWithPhoto). Handler DI-чистый; route inject.
  // storageKey = Telegram file_id (fayl yuklash TX tashqarisida — yo'q).
  separateSlabWithPhoto(
    input: SeparateSlabInput,
    photo: { storageKey: string; takenById: string },
  ): Promise<string>;
  /**
   * W9-D — claim update_id before domain work (TelegramWebhookReceipt).
   * Injected so unit tests can assert replay without a real DB.
   * Default in route: claimTelegramUpdateId from telegram-update-receipt.ts.
   *  • claimed      → process
   *  • already_seen → no-op (no second Photo/slab)
   *  • error        → process anyway (availability > silent drop; log upstream)
   */
  claimTelegramUpdate(
    updateId: number,
  ): Promise<"claimed" | "already_seen" | "error">;
  /**
   * W10-B — domain throw bo'lsa claim'ni olib tashlash (Telegram retry ishlasin).
   * Default: releaseTelegramUpdateId. Never throws.
   */
  releaseTelegramUpdate(updateId: number): Promise<boolean>;
}

// ───────────────────────── Matnlar (uz/ru) ─────────────────────────

const MSG_ASK_CONTACT =
  "Onyx bot. Для регистрации поделитесь своим номером телефона.";
const MSG_NOT_FOUND =
  "Ваш номер телефона не найден в списке. Обратитесь к вашему менеджеру.";
const MSG_AMBIGUOUS =
  "По вашему номеру найдено несколько записей. Обратитесь к вашему менеджеру.";
const MSG_ALREADY_LINKED =
  "Этот Telegram-аккаунт уже привязан к другому пользователю. Обратитесь к вашему менеджеру.";
const MSG_TRY_LATER = "Произошла ошибка. Попробуйте ещё раз чуть позже.";
// Onboarding — номер не привязан ни к одному аккаунту: создаём заявку на доступ,
// её одобряет владелец в панели. Доступ НЕ выдаётся автоматически.
const MSG_ACCESS_REQUESTED =
  "Заявка на доступ отправлена. Как только владелец её одобрит, доступ откроется и вы получите сообщение.";
const successMessage = (name: string) =>
  `Вы зарегистрированы, ${name}. Теперь фотозапросы будут приходить сюда.`;

// Foto oqimi (TG-B2) matnlari — skladchi/menejer ruscha ko'radi.
const MSG_PHOTO_NOT_REGISTERED =
  "Вас нет в списке. Отправьте /start.";
// D3 — foto qabul / singan oqimlari FAQAT sklad xodimlari uchun (TZ §3:
// canManageWarehouse — OWNER/WAREHOUSE). MANAGER/PARTNER va noma'lum rol
// bu funksiyalarni ishga tushira olmaydi (zapros egallamaydi, AI chaqirmaydi).
const MSG_PHOTO_NOT_WAREHOUSE =
  "Эта функция доступна только складчикам.";
const MSG_PHOTO_NO_REQUEST = "Пока нет активного фото-запроса.";
// §6.1 — reply yopilgan (DONE/CANCELLED) zaprosga tushdi: yangi plita AJRATMAYMIZ
// (menejer «Готово» bosgach, eski vazifaga javob berilgan foto inventarni buzmasin).
const MSG_PHOTO_REQUEST_CLOSED =
  "Этот запрос уже закрыт. Обратитесь к вашему менеджеру для нового запроса.";
const MSG_PHOTO_SAVED = "✅ Фото сохранено, спасибо!";
// Audit 3.1 — bare foto + 2+ PENDING: FIFO adashmasin; reply-first saqlanadi.
const MSG_PHOTO_AMBIGUOUS_HEADER =
  "Открыто несколько фото-запросов. Не могу выбрать автоматически — ответьте (reply) фото на нужное задание:";
const managerNotifyMessage = (stoneTypeName: string) =>
  `📷 Фото готово: ${stoneTypeName}.`;

/** Bare-foto 2+ PENDING ro'yxati (batch/tosh nomi + lokatsiya). Export — unit-test. */
export function buildPhotoAmbiguousMessage(
  pending: Array<{
    batch: { stoneType: { name: string } | null };
    batchLocation: { block: string; landmark: string } | null;
  }>,
): string {
  const lines = pending.map((r, i) => {
    const name = r.batch.stoneType?.name ?? "камень";
    const loc = r.batchLocation
      ? `блок ${r.batchLocation.block}, ориентир ${r.batchLocation.landmark}`
      : "локация не указана";
    return `${i + 1}) ${name} — ${loc}`;
  });
  return [MSG_PHOTO_AMBIGUOUS_HEADER, ...lines].join("\n");
}

// SK-4b login matnlari (o'zbekcha — skladchi ko'radi).
const MSG_LOGIN_NOT_REGISTERED =
  "Вас нет в списке. Отправьте /start, чтобы привязать номер телефона.";
const loginLinkMessage = (url: string) =>
  `Ссылка для входа (действует 2 минуты):\n${url}\nНикому не пересылайте эту ссылку.`;
// Sozlama yetishmasa (AUTH_COOKIE_SECRET yoki APP_BASE_URL yo'q) — buzuq havola
// o'rniga shu xabar. Skladchini chalg'itmaydi; sabab log'da qoladi.
const MSG_LOGIN_UNAVAILABLE =
  "Сейчас войти не удалось. Попробуйте чуть позже или обратитесь к вашему менеджеру.";

// §5.5b — singan tosh (AI-shakl) matnlari (o'zbekcha — skladchi ko'radi).
const MSG_SINGAN_INSTRUCTION =
  "Битый камень: отправьте фото и в подписи (caption) напишите «бой» — ИИ обведёт форму, затем размеры вы введёте на сайте.";
const MSG_SINGAN_DOWNLOAD_FAILED =
  "Не удалось загрузить фото. Попробуйте отправить ещё раз чуть позже.";
const MSG_SINGAN_AI_FAILED =
  "ИИ сейчас недоступен — введите вручную через страницу /razbit или попробуйте позже.";
// APP_BASE_URL sozlanmagan — buzuq havola yubormaymiz (MSG_LOGIN_UNAVAILABLE uslubi).
const MSG_SINGAN_UNAVAILABLE =
  "Сейчас не удалось подготовить ссылку. Попробуйте позже или обратитесь к вашему менеджеру.";
// Русское согласование числительного: 1 сторона · 2–4 стороны · 5+ сторон.
const pluralSides = (n: number): string => {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return "сторон";
  if (mod10 === 1) return "сторона";
  if (mod10 >= 2 && mod10 <= 4) return "стороны";
  return "сторон";
};
const singanLinkMessage = (sides: number, url: string) =>
  `Форма определена: ${sides} ${pluralSides(sides)}. Откройте ссылку, чтобы ввести размеры:\n${url}`;

// request_contact klaviaturasi — telefonni bir tugma bilan ulashish.
const CONTACT_KEYBOARD: TgReplyKeyboardMarkup = {
  keyboard: [[{ text: "📱 Поделиться номером", request_contact: true }]],
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
/**
 * §5.5b — rasm izohi «singan tosh» oqimini so'rayaptimi? «singan» (lotin) yoki
 * «бой» (kirill) so'zi izohning istalgan joyida, katta-kichikligidan qat'i nazar.
 */
function isBrokenStoneCaption(caption: string): boolean {
  return /singan|бой/i.test(caption);
}

/**
 * `/singan` buyrug'ini aniqlaydi (isLoginCommand uslubi): birinchi so'z aynan
 * `/singan` yoki `/singan@BotName`. `/singanfoo` kabi yopishgan matnga tegmaydi.
 */
function isSinganCommand(text: string): boolean {
  const first = text.trim().split(/\s+/)[0];
  return first === "/singan" || first.startsWith("/singan@");
}

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
  // W9-D / W10-B — claim before domain; on domain failure RELEASE so Telegram
  // retry is not a permanent no-op (sharp edge: claim kept + TX rolled back
  // would drop the photo forever).
  let claimedUpdateId: number | null = null;
  try {
    // W9-D — update_id at-most-once. Telegram retries the same update when it
    // does not get a timely 200; without a claim, handlePhoto would
    // separateSlab + photo again (duplicate slabs / SAMPLE photos).
    // Claim BEFORE domain work. already_seen → full no-op. error → process
    // once (fail-open) so a receipt-table outage does not drop all updates.
    if (typeof update.update_id === "number") {
      const claim = await deps.claimTelegramUpdate(update.update_id);
      if (claim === "already_seen") return;
      if (claim === "claimed") claimedUpdateId = update.update_id;
    }

    const message = update.message ?? update.edited_message;
    if (!message) return; // callback_query va h.k. — TG-A da e'tiborsiz.

    const chatId = message.chat.id;

    // 1) Kontakt ulashildi → telefon bo'yicha User topib bog'lash.
    if (message.contact) {
      await handleContact(
        message.contact,
        message.from?.id,
        chatId,
        deps,
        message.from?.username,
      );
      return;
    }

    // 2a) §5.5b: rasm + «singan»/«бой» izohi → AI-shakl oqimi. Izohsiz (yoki
    //     boshqa izohli) rasm 2b'dagi ESKI PhotoRequest oqimida qoladi.
    if (
      Array.isArray(message.photo) &&
      message.photo.length > 0 &&
      typeof message.caption === "string" &&
      isBrokenStoneCaption(message.caption)
    ) {
      await handleBrokenStone(message, deps);
      return;
    }

    // 2b) Foto (TG-B2) → PENDING zaprosga biriktirish, DONE qilish, menejerni xabardor.
    if (Array.isArray(message.photo) && message.photo.length > 0) {
      await handlePhoto(message, deps);
      return;
    }

    // 2c) §5.5b: `/singan` matn buyrug'i (rasmsiz) → yo'riqnoma.
    if (typeof message.text === "string" && isSinganCommand(message.text)) {
      await deps.sendMessage(chatId, MSG_SINGAN_INSTRUCTION);
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
    // W10-B — domain yiqilsa claim'ni bo'shat: Telegram qayta yuborsa qayta urinadi.
    // Success pathda claim qoladi (replay → already_seen).
    if (claimedUpdateId !== null) {
      try {
        await deps.releaseTelegramUpdate(claimedUpdateId);
      } catch (releaseErr) {
        console.error(
          "[telegram-webhook] releaseTelegramUpdate xatosi:",
          releaseErr,
        );
      }
    }
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

/**
 * §5.5b — singan tosh oqimi: rasm + «singan» izohi. Rasm yuklab olinadi, AI
 * shaklni polygon sifatida aniqlaydi, natija (vertices + file_id) stateless
 * draft qilib URL'ga kodlanadi va skladchiga /singan havolasi yuboriladi.
 * O'lchovlarni odam saytda kiritadi (TZ §5.5 — AI faqat SHAKL chizadi).
 *
 * Fail-closed: yuklab olish/AI xatosi → halol o'zbekcha xabar, /razbit qo'lda
 * yo'li ochiq qoladi. handleUpdate try/catch ichida — throw bo'lsa ham 200.
 */
async function handleBrokenStone(
  message: NonNullable<TgUpdate["message"]>,
  deps: WebhookDeps,
): Promise<void> {
  const chatId = message.chat.id;

  // (1) Yuboruvchi bog'langan va faol bo'lishi shart (foto oqimidagi guard).
  const user = await deps.db.user.findFirst({
    where: { telegramId: String(chatId), isActive: true },
    select: { id: true, role: true },
  });
  if (!user) {
    await deps.sendMessage(chatId, MSG_PHOTO_NOT_REGISTERED);
    return;
  }

  // (1b) D3 — sklad huquqi shart. Singan (bay) yozib olish ombor ishi; sklad
  // bo'lmagan rol (MANAGER/PARTNER/noma'lum) AI'ga tegmaydi, hech narsa
  // yuklab olinmaydi. capabilitiesFor — yagona haqiqat manbai (TZ §3).
  if (
    !capabilitiesFor(user.role as Role, { canSeePurchasePrice: false })
      .canManageWarehouse
  ) {
    await deps.sendMessage(chatId, MSG_PHOTO_NOT_WAREHOUSE);
    return;
  }

  // (2) APP_BASE_URL sozlanmagan bo'lsa — AI'ga pul sarflamasdan darhol
  // to'xtaymiz (buzuq havola yuborilmasin, MSG_LOGIN_UNAVAILABLE uslubi).
  if (!deps.appBaseUrl) {
    console.warn(
      "[telegram-webhook] singan: appBaseUrl bo'sh — env sozlanmagan (APP_BASE_URL).",
    );
    await deps.sendMessage(chatId, MSG_SINGAN_UNAVAILABLE);
    return;
  }

  // (3) Eng katta o'lcham — massivning oxirgi elementi (Telegram o'sish tartibi).
  const photos = message.photo!;
  const largest = photos[photos.length - 1];

  const downloaded = await deps.downloadPhotoBase64(largest.file_id);
  if (!downloaded) {
    await deps.sendMessage(chatId, MSG_SINGAN_DOWNLOAD_FAILED);
    return;
  }

  // (4) AI shakl-aniqlash (fail-closed: null → halol xabar, qo'lda yo'l qoladi).
  const shape = await deps.analyzeShape(downloaded.base64, downloaded.mediaType);
  if (!shape) {
    await deps.sendMessage(chatId, MSG_SINGAN_AI_FAILED);
    return;
  }

  // (5) Stateless draft: polygon + file_id → base64url → /singan?d=… havolasi.
  const draft = encodeShapeDraft({
    vertices: shape.vertices,
    fileId: largest.file_id,
  });
  const url = `${deps.appBaseUrl}/singan?d=${draft}`;
  await deps.sendMessage(chatId, singanLinkMessage(shape.sideCount, url));
}

async function handleContact(
  contact: NonNullable<TgUpdate["message"]>["contact"],
  fromId: number | undefined,
  chatId: number,
  deps: WebhookDeps,
  username?: string,
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
    // Onboarding: телефон не привязан ни к одному аккаунту → это НОВЫЙ человек.
    // Создаём/обновляем заявку на доступ (PENDING). Владелец одобрит в /accounts —
    // доступ НЕ выдаётся автоматически (защита: нельзя самопривязаться к складу).
    const name =
      [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() ||
      null;
    try {
      await deps.db.telegramAccessRequest.upsert({
        where: { telegramId: String(chatId) },
        create: {
          telegramId: String(chatId),
          name,
          username: username ?? null,
          phone: wanted,
        },
        // Повторная заявка (напр. после отклонения) — обновляем и снова PENDING.
        update: { name, username: username ?? null, phone: wanted, status: "PENDING" },
      });
      await deps.sendMessage(chatId, MSG_ACCESS_REQUESTED);
    } catch (err) {
      console.error("[telegram-webhook] access-request upsert xatosi:", err);
      await deps.sendMessage(chatId, MSG_TRY_LATER);
    }
    return;
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

  // (1b) D3 — foto-zaproslar FAQAT sklad xodimlariga yuboriladi (photo-requests.ts:
  // role WAREHOUSE). Sklad huquqi bo'lmagan rol (MANAGER/PARTNER/noma'lum) navbatdagi
  // zaprosni egallab qo'ymasin: hech qanday findFirst/updateMany va Photo create YO'Q.
  if (
    !capabilitiesFor(user.role as Role, { canSeePurchasePrice: false })
      .canManageWarehouse
  ) {
    await deps.sendMessage(chatId, MSG_PHOTO_NOT_WAREHOUSE);
    return;
  }

  // (2) Eng katta o'lcham — massivning oxirgi elementi (Telegram o'sish tartibi).
  const photos = message.photo!;
  const largest = photos[photos.length - 1];

  const requestInclude = {
    batch: {
      select: { stoneTypeId: true, stoneType: { select: { name: true } } },
    },
    batchLocation: { select: { block: true, landmark: true } },
  } as const;

  // (3) §5.3 — REPLY-TO ustunligi. Skladchi bot yuborgan aniq vazifa xabariga
  // reply qilib foto yuborgan bo'lsa (≥2 ochiq so'rovda toshni adashtirmaslik
  // uchun), o'sha xabar bo'yicha PhotoDispatch topamiz va foto AYNAN shu
  // fotozaprosga biriktiriladi — FIFO fallback'dan OLDIN, undan ustun.
  //
  // §6.1 — LIFECYCLE: bir zapros N plita to'playdi (skladchi 3 plitani fotolab
  // yuboradi → 3 alohida Slab). Shuning uchun zaprosni BIRINCHI fotoda YOPMAYMIZ.
  // Zaprosni menejer «Готово» tugmasi bilan DONE qiladi (/fotozapros). Reply-to
  // AYNAN o'z zaprosiga bog'lanadi, LEKIN zapros allaqachon YOPILGAN (DONE/CANCELLED)
  // bo'lsa — RAD etamiz (yangi Slab yaratmaymiz): menejer «Готово» bosgach eski
  // vazifaga javob berilgan foto cheksiz inventar drift qilmasin (mahsulot qарори).
  let claimed: PendingPhotoRequest | null = null;
  let replyToResolved = false; // reply aynan bizning vazifa xabarimizga tushdimi

  const replyToMessageId = message.reply_to_message?.message_id;
  if (typeof replyToMessageId === "number") {
    const dispatch = await deps.db.photoDispatch.findFirst({
      where: { chatId: String(chatId), messageId: replyToMessageId },
      select: { photoRequestId: true },
    });
    if (dispatch) {
      replyToResolved = true; // shu skladchiga yuborilgan tanish vazifa xabari.
      claimed = await deps.db.photoRequest.findFirst({
        where: { id: dispatch.photoRequestId },
        include: requestInclude,
      });
    }
  }

  // (3b) §6.1 — reply AYNAN tanish zaprosga tushdi-yu, lekin u allaqachon YOPILGAN
  // (menejer «Готово» → DONE, yoki CANCELLED): RAD etamiz — yangi Slab/Photo YO'Q,
  // skladchiga zapros yopilganini aytamiz (aks holda yopilgandan keyingi har bir
  // javob yangi plita ajratib inventarni cheksiz shishirar edi).
  if (replyToResolved && claimed && claimed.status !== "PENDING") {
    await deps.sendMessage(chatId, MSG_PHOTO_REQUEST_CLOSED);
    return;
  }

  // (4) Bare / begona-reply fallback — FAQAT tanish vazifaga reply BO'LMAGANDA.
  // Reply aynan vazifaga tushgan-u, lekin zapros topilmasa (o'chirilgan) —
  // bu yerga TUSHMAYMIZ (boshqa toshga noto'g'ri biriktirmaslik): MSG_PHOTO_NO_REQUEST.
  //
  // Audit 3.1 xavfsiz disambiguation:
  //  • 0 PENDING → «faol so'rov yo'q»
  //  • 1 PENDING → hozirgidek biriktir (tez yo'l / FIFO)
  //  • 2+ PENDING → BIRIKTIRMAYMIZ (noto'g'ri tosh xavfi); ochiq so'rovlar
  //    ro'yxati + reply so'rash (mavjud reply-first mantiq ishlaydi)
  if (!claimed && !replyToResolved) {
    const pending = await deps.db.photoRequest.findMany({
      where: {
        status: "PENDING",
        OR: [{ assigneeId: null }, { assigneeId: user.id }],
      },
      orderBy: { createdAt: "asc" },
      include: requestInclude,
    });
    if (pending.length === 0) {
      await deps.sendMessage(chatId, MSG_PHOTO_NO_REQUEST);
      return;
    }
    if (pending.length === 1) {
      claimed = pending[0]!;
    } else {
      await deps.sendMessage(chatId, buildPhotoAmbiguousMessage(pending));
      return;
    }
  }
  if (!claimed) {
    await deps.sendMessage(chatId, MSG_PHOTO_NO_REQUEST);
    return;
  }

  // (4b) ТЗ №3 — УЗОР-подгруппа: фото привязывается к узору (Photo.batchPatternId),
  // БЕЗ создания плиты (это не отдельная плита, а образец узора). Один снимок
  // ЗАКРЫВАЕТ запрос (DONE) — в отличие от слэб-запроса, что копит N плит.
  if (claimed.batchPatternId) {
    await deps.db.photo.create({
      data: {
        storageKey: largest.file_id,
        kind: "SAMPLE", // vid/узор namunasi (плита EMAS)
        takenAt: new Date(),
        takenById: user.id,
        stoneTypeId: claimed.batch.stoneTypeId,
        slabId: null,
        batchPatternId: claimed.batchPatternId,
        photoRequestId: claimed.id,
      },
    });
    await deps.db.photoRequest.update({
      where: { id: claimed.id },
      data: { status: "DONE", completedAt: new Date() },
    });
    await deps.sendMessage(chatId, MSG_PHOTO_SAVED);
    // Менежерни хабардор қиламиз (алоҳида try/catch — асосий оқим бузилмасин).
    try {
      const manager = await deps.db.user.findUnique({
        where: { id: claimed.managerId },
        select: { telegramId: true },
      });
      if (manager?.telegramId) {
        const stoneName = claimed.batch.stoneType?.name ?? "камень";
        await deps.sendMessage(manager.telegramId, managerNotifyMessage(stoneName));
      }
    } catch (err) {
      console.error("[telegram-webhook] менежерни хабардор қилиш хатоси (узор):", err);
    }
    return;
  }

  // (5) §4.1 L3 / §6.1 — Slab + Photo.
  // Yangi ajratish (slabId==null): HAR foto → bitta «Плита №N» + Photo.SLAB
  // BIR tranzaksiyada (W10-B separateSlabWithPhoto). Eski: separateSlab COMMIT
  // so'ng photo.create yiqilsa → fotosiz plita + update_id claim → retry no-op.
  // Qayta surat (slabId to'la): faqat Photo (yangi slab YO'Q).
  //
  // Network: sendMessage TX DAN KEYIN (past). Fayl yuklash yo'q — faqat file_id.
  const loc = claimed.batchLocation;
  if (claimed.slabId == null) {
    await deps.separateSlabWithPhoto(
      {
        batchId: claimed.batchId,
        stoneTypeId: claimed.batch.stoneTypeId,
        photoRequestId: claimed.id,
        block: loc?.block ?? "?",
        landmark: loc?.landmark ?? "?",
        needsCheck: loc == null,
        separatedById: user.id,
      },
      { storageKey: largest.file_id, takenById: user.id },
    );
  } else {
    await deps.db.photo.create({
      data: {
        storageKey: largest.file_id,
        kind: "SLAB",
        takenAt: new Date(),
        takenById: user.id,
        stoneTypeId: claimed.batch.stoneTypeId,
        slabId: claimed.slabId,
        photoRequestId: claimed.id,
      },
    });
  }

  // (6) Skladchiga tasdiq — DB TX tashqarisida (sekin tarmoq lock ushlamasin).
  await deps.sendMessage(chatId, MSG_PHOTO_SAVED);

  // (7) Menejerni xabardor qilamiz — ALOHIDA try/catch: bu yiqilsa skladchining
  // saqlash+javob oqimi buzilmasin. Muvaffaqiyatsizlik claim'ni BO'SHATMAYDI
  // (slab+photo allaqachon commit).
  try {
    const manager = await deps.db.user.findUnique({
      where: { id: claimed.managerId },
      select: { telegramId: true },
    });
    if (manager?.telegramId) {
      const stoneName = claimed.batch.stoneType?.name ?? "камень";
      await deps.sendMessage(
        manager.telegramId,
        managerNotifyMessage(stoneName),
      );
    }
  } catch (err) {
    console.error("[telegram-webhook] menejerni xabardor qilish xatosi:", err);
  }
}

