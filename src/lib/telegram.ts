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

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  contact?: TgContact;
  photo?: TgPhotoSize[];
}

export interface TgUpdate {
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

/** POST helper — JSON body bilan Bot API metodini chaqiradi. */
async function apiPost<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const token = getToken();
  if (!token) {
    console.warn(`[telegram] TELEGRAM_BOT_TOKEN o'rnatilmagan — ${method} o'tkazib yuborildi.`);
    return null;
  }
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[telegram] ${method} muvaffaqiyatsiz (${res.status}): ${text}`);
    return null;
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
  if (!json || json.ok !== true) {
    console.warn(`[telegram] ${method} javobi ok emas:`, json);
    return null;
  }
  return json.result ?? null;
}

/** Xabar yuboradi. opts.reply_markup — kontakt so'rovi klaviaturasi uchun. */
export async function sendMessage(
  chatId: number | string,
  text: string,
  opts?: SendMessageOptions,
): Promise<void> {
  await apiPost("sendMessage", {
    chat_id: chatId,
    text,
    ...(opts?.parse_mode ? { parse_mode: opts.parse_mode } : {}),
    ...(opts?.disable_notification ? { disable_notification: true } : {}),
    ...(opts?.reply_markup ? { reply_markup: opts.reply_markup } : {}),
  });
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
  return apiPost<TgFile>("getFile", { file_id: fileId });
}

/** Fayl baytlarini yuklab oladi. filePath — getFile natijasidagi file_path. */
export async function downloadFile(filePath: string): Promise<Uint8Array | null> {
  const token = getToken();
  if (!token) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN o'rnatilmagan — downloadFile o'tkazib yuborildi.");
    return null;
  }
  const res = await fetch(`${API_ROOT}/file/bot${token}/${filePath}`);
  if (!res.ok) {
    console.warn(`[telegram] downloadFile muvaffaqiyatsiz (${res.status}).`);
    return null;
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
