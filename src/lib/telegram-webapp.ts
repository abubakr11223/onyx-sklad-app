// §5.9 — Telegram Mini App: проверка initData (аутентификация внутри Telegram).
// Telegram открывает наш сайт в webview и передаёт подписанный initData. Проверка
// по официальной схеме Telegram:
//   data_check_string = отсортированные поля (кроме hash), "key=value" через \n
//   secret_key        = HMAC_SHA256(key="WebAppData", data=bot_token)   [raw]
//   computed_hash     = hex(HMAC_SHA256(key=secret_key, data=data_check_string))
//   valid ⇔ computed_hash === hash (timing-safe) И auth_date не слишком старый
//
// EDGE-безопасно: только Web Crypto (globalThis.crypto.subtle), без node:crypto.
// Никогда не бросает — типизированный результат (как verify* в auth.ts).

const enc = new TextEncoder();

async function hmacRaw(
  keyBytes: Uint8Array,
  msgBytes: Uint8Array,
): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    msgBytes as unknown as ArrayBuffer,
  );
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Постоянное по времени сравнение hex-строк (анти-timing). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type InitDataResult =
  | { ok: true; telegramId: string }
  | { ok: false; reason: "malformed" | "badsig" | "expired" | "nosecret" };

/**
 * Проверяет Telegram WebApp initData. Возвращает telegramId (id пользователя из
 * поля user) при валидной подписи и свежем auth_date.
 *
 * @param initData  сырой initData из window.Telegram.WebApp.initData (query-string)
 * @param botToken  TELEGRAM_BOT_TOKEN
 * @param nowMs     текущее время (мс) — для проверки свежести
 * @param maxAgeSec максимальный возраст initData (по умолчанию 24 часа)
 */
export async function validateTelegramInitData(
  initData: string,
  botToken: string,
  nowMs: number,
  maxAgeSec = 24 * 60 * 60,
): Promise<InitDataResult> {
  if (!botToken) return { ok: false, reason: "nosecret" };
  if (!initData) return { ok: false, reason: "malformed" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "malformed" };

  // data_check_string: все поля КРОМЕ hash, отсортированы, "key=value" через \n.
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacRaw(enc.encode("WebAppData"), enc.encode(botToken));
  const computed = toHex(await hmacRaw(secretKey, enc.encode(dataCheckString)));
  if (!timingSafeEqualHex(computed, hash)) {
    return { ok: false, reason: "badsig" };
  }

  // Свежесть: auth_date (сек) не старше maxAge — защита от повторного использования.
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return { ok: false, reason: "malformed" };
  if (nowMs / 1000 - authDate > maxAgeSec) return { ok: false, reason: "expired" };

  // Достаём telegram id из поля user (JSON).
  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "malformed" };
  let telegramId: string;
  try {
    const user = JSON.parse(userRaw) as { id?: number | string };
    if (user.id == null) return { ok: false, reason: "malformed" };
    telegramId = String(user.id);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, telegramId };
}
