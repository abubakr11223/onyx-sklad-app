// Telegram Bot API klienti (TG-A). Dependency-free — faqat global fetch.
// Token @BotFather'dan (TELEGRAM_BOT_TOKEN). Token bo'lmasa modul import'da
// yiqilmaydi — chaqirilganda ogohlantiradi va no-op / xato qaytaradi.
//
// Base URL: https://api.telegram.org/bot<token>
// Fayl yuklab olish: https://api.telegram.org/file/bot<token>/<file_path>

const API_ROOT = "https://api.telegram.org";

// ───────────────────────── Update shakllari ─────────────────────────
// Bizga kerak bo'lgan minimal maydonlar (to'liq Bot API tipi emas).

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type?: string;
}

export interface TgContact {
  phone_number: string;
  first_name?: string;
  last_name?: string;
  user_id?: number; // ulashgan kontakt kimga tegishli (o'ziniki bo'lsa = from.id)
}

// Bitta rasm o'lchami. Telegram bir nechta o'lchamni o'sish tartibida beradi —
// eng kattasi massivning oxirgi elementi.
export interface TgPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/**
 * Hujjat («Send as File»). Rasm shu yo'l bilan ham kelishi mumkin
 * (siqilmagan / iPhone HEIC / katta fayl) — webhook mime+size bo'yicha qabul
 * yoki rad etadi. storageKey baribir file_id (model o'zgarmaydi).
 */
export interface TgDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  /** Thumbnail (ixtiyoriy) — biz ishlatmaymiz; faqat shakl to'liqligi uchun. */
  thumb?: TgPhotoSize;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  contact?: TgContact;
  photo?: TgPhotoSize[];
  /** «Send as File» / uncompressed image yoki boshqa hujjat. */
  document?: TgDocument;
  /**
   * Quyidagi maydonlar faqat «bot ishlata olmaydi → qisqa javob» uchun
   * mavjudligini aniqlash (to'liq Bot API shakli emas).
   */
  video?: { file_id: string };
  voice?: { file_id: string };
  audio?: { file_id: string };
  sticker?: { file_id: string };
  animation?: { file_id: string };
  video_note?: { file_id: string };
  /** Rasm/hujjat ostidagi izoh (§5.5b: «singan» marshrutlash shu orqali). */
  caption?: string;
  /**
   * Album: Telegram delivers each photo as a separate update sharing this id.
   * W9-D: not photo[] sizes — each message has its own photo[] of resolutions.
   * Handler processes each update independently (multi-slab §6.1). Multi-pending
   * bare-photo disambiguation (05ba2a3) still applies per update.
   */
  media_group_id?: string;
  /**
   * §5.3 — skladchi qaysi vazifaga JAVOB (reply) berayotgani. Bot yuborgan
   * vazifa xabariga reply qilingan foto shu xabarning message_id'sini olib
   * keladi → aynan o'sha fotozaprosga biriktiriladi (FIFO'dan ustun turadi).
   */
  reply_to_message?: TgMessage;
}

export interface TgUpdate {
  /** Unique per delivery; Telegram may retry the same update_id if no timely 200. */
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}

// reply_markup — bizga faqat request_contact klaviatura kerak.
export interface TgReplyKeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}

export interface TgReplyKeyboardMarkup {
  keyboard: TgReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  is_persistent?: boolean;
}

export interface TgReplyKeyboardRemove {
  remove_keyboard: true;
}

export interface SendMessageOptions {
  reply_markup?: TgReplyKeyboardMarkup | TgReplyKeyboardRemove;
  parse_mode?: "HTML" | "MarkdownV2";
  disable_notification?: boolean;
}

function getToken(): string | undefined {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.length > 0 ? t : undefined;
}

/**
 * BUG-04 — apiPost endi xatoni YUTMAYDI. Ilgari token yo'q / non-2xx / ok!==true
 * holatlarida faqat console.warn qilib `null` qaytarardi, shuning uchun
 * chaqiruvchi (masalan Promise.allSettled) HECH QACHON yetkazilmaslikni
 * ko'rmasdi — dispatchedTo yolg'on chiqardi. Endi diskriminatsiyalangan natija
 * qaytadi: chaqiruvchi yetkazilmaganini aniqlab, yozib va qayta urinishi mumkin.
 * console.warn saqlanadi (operator loglari uchun).
 */
export type ApiResult<T> =
  | { ok: true; result: T | null }
  | { ok: false; error: string };

/** POST helper — JSON body bilan Bot API metodini chaqiradi. */
async function apiPost<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<ApiResult<T>> {
  const token = getToken();
  if (!token) {
    console.warn(`[telegram] TELEGRAM_BOT_TOKEN o'rnatilmagan — ${method} o'tkazib yuborildi.`);
    return { ok: false, error: "no_token" };
  }
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // §8: aloqa uzilishi — throw QILMAYMIZ, natijaga o'raymiz (qayta urinish uchun).
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[telegram] ${method} tarmoq xatosi: ${msg}`);
    return { ok: false, error: `network: ${msg}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[telegram] ${method} muvaffaqiyatsiz (${res.status}): ${text}`);
    return { ok: false, error: `http_${res.status}: ${text}`.slice(0, 500) };
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
  if (!json || json.ok !== true) {
    console.warn(`[telegram] ${method} javobi ok emas:`, json);
    return { ok: false, error: "api_not_ok" };
  }
  return { ok: true, result: json.result ?? null };
}

/**
 * sendMessage natijasi — yetkazildi (ok) yoki xato (error sababi bilan).
 * §5.3: muvaffaqiyatda Telegram qaytargan `message_id` ham beriladi — chaqiruvchi
 * uni PhotoDispatch'ga saqlaydi, keyin skladchi shu xabarga reply qilgan fotoni
 * aynan shu fotozaprosga bog'lash uchun ishlatiladi. API message_id bermasa null.
 */
export type SendResult =
  | { ok: true; messageId: number | null }
  | { ok: false; error: string };

/**
 * Xabar yuboradi. opts.reply_markup — kontakt so'rovi klaviaturasi uchun.
 * BUG-04: endi `void` emas, `SendResult` qaytaradi — chaqiruvchi yetkazilishni
 * (SENT/FAILED) yozishi va yetkazilmaganda menejerni ogohlantirishi uchun.
 * §5.3: natijada yuborilgan xabarning message_id'si ham qaytadi (reply-to bog'lash).
 */
export async function sendMessage(
  chatId: number | string,
  text: string,
  opts?: SendMessageOptions,
): Promise<SendResult> {
  const r = await apiPost<TgMessage>("sendMessage", {
    chat_id: chatId,
    text,
    ...(opts?.parse_mode ? { parse_mode: opts.parse_mode } : {}),
    ...(opts?.disable_notification ? { disable_notification: true } : {}),
    ...(opts?.reply_markup ? { reply_markup: opts.reply_markup } : {}),
  });
  return r.ok
    ? { ok: true, messageId: r.result?.message_id ?? null }
    : { ok: false, error: r.error };
}

// ───────────────────────── Fayl (TG-B uchun tayyor) ─────────────────────────

export interface TgFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

/** getFile — file_id bo'yicha file_path oladi (keyin downloadFile). */
export async function getFile(fileId: string): Promise<TgFile | null> {
  const r = await apiPost<TgFile>("getFile", { file_id: fileId });
  return r.ok ? r.result : null;
}

/**
 * Fayl baytlarini yuklab oladi. filePath — getFile natijasidagi file_path.
 * Аудит ТЗ №7 #30 follow-up (B5) — раньше fetch НЕ был обёрнут в try/catch:
 * network-ошибка (ECONNRESET, DNS) роняла downloadFile throws-ом, в отличие
 * от getFile (apiPost ловит fetch). Регрессия к 500 в /api/photo/[id] и в
 * webhook downloadPhotoBase64 (там ожидается null → фотозапрос переспросит).
 * Теперь единый fail-closed контракт: no-token / non-2xx / network → null + warn.
 */
export async function downloadFile(filePath: string): Promise<Uint8Array | null> {
  const token = getToken();
  if (!token) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN o'rnatilmagan — downloadFile o'tkazib yuborildi.");
    return null;
  }
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}/file/bot${token}/${filePath}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[telegram] downloadFile tarmoq xatosi: ${msg}`);
    return null;
  }
  if (!res.ok) {
    console.warn(`[telegram] downloadFile muvaffaqiyatsiz (${res.status}).`);
    return null;
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
