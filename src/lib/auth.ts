// Umumiy parol darvozasi (Part 1 — auth). Web Crypto API (globalThis.crypto.subtle)
// ustida qurilgan — bir xil kod ham middleware (Edge), ham route-handler'da ishlaydi.
// APP_PASSWORD — kirish paroli, AUTH_COOKIE_SECRET — HMAC imzo kaliti.

export const COOKIE_NAME = "onyx_auth";

// Imzolanadigan barqaror payload. Token = `${TOKEN_PAYLOAD}.${signatureHex}`.
const TOKEN_PAYLOAD = "onyx-auth-v1";

function getEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/**
 * Doimiy vaqtli (timing-safe) satr solishtirish. Uzunlik bir xil bo'lmasa —
 * baribir to'liq belgilar bo'ylab XOR yig'iladi (birinchi farqda chiqib ketmaydi).
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  // Solishtiruvni belgilangan uzunlikda (a bo'yicha) olib boramiz.
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < aBytes.length; i++) {
    // b'dan tashqariga chiqib ketsak — 0 bilan solishtiramiz (farq sifatida hisoblanadi).
    diff |= aBytes[i] ^ (i < bBytes.length ? bBytes[i] : 0);
  }
  return diff === 0;
}

/**
 * Parolni APP_PASSWORD bilan timing-safe solishtiradi. APP_PASSWORD o'rnatilmagan
 * bo'lsa — noto'g'ri sozlash: false qaytaradi va ogohlantiradi (build'ni buzmaydi).
 */
export function verifyPassword(input: string): boolean {
  const expected = getEnv("APP_PASSWORD");
  if (!expected) {
    console.warn("[auth] APP_PASSWORD o'rnatilmagan — kirish rad etiladi.");
    return false;
  }
  return timingSafeEqual(input, expected);
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toHex(sig);
}

/** HMAC-SHA256 imzoli token yaratadi: `payload.signatureHex`. */
export async function signToken(): Promise<string> {
  const secret = getEnv("AUTH_COOKIE_SECRET");
  if (!secret) {
    console.warn("[auth] AUTH_COOKIE_SECRET o'rnatilmagan — token yaratib bo'lmadi.");
    return "";
  }
  const sig = await hmacHex(TOKEN_PAYLOAD, secret);
  return `${TOKEN_PAYLOAD}.${sig}`;
}

/** Tokenni qayta hisoblab, imzoni timing-safe solishtiradi. */
export async function verifyToken(token: string): Promise<boolean> {
  const secret = getEnv("AUTH_COOKIE_SECRET");
  if (!secret) {
    console.warn("[auth] AUTH_COOKIE_SECRET o'rnatilmagan — token rad etiladi.");
    return false;
  }
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (payload !== TOKEN_PAYLOAD) return false;
  const expected = await hmacHex(TOKEN_PAYLOAD, secret);
  return timingSafeEqual(signature, expected);
}

/** Cookie qiymati bo'yicha autentifikatsiyani tekshiradi (yordamchi). */
export async function isAuthedFromCookie(
  cookieValue: string | undefined,
): Promise<boolean> {
  if (!cookieValue) return false;
  return verifyToken(cookieValue);
}

// ───────────────────────── SK-4b: identity-carrying tokens ─────────────────────────
// Yuqoridagi TOKEN_PAYLOAD identitetsiz parol-darvozasi uchun. Quyidagilar esa
// aniq foydalanuvchini (userId) tashuvchi imzolangan tokenlar — Telegram magic-link
// login uchun. HAMMASI STATELESS: faqat AUTH_COOKIE_SECRET ustidagi HMAC, DB YO'Q.
//
// Prefiks izolatsiyasi: magic-token payload'i `magic.` bilan, session-token esa
// `session.` bilan boshlanadi. Imzo payload'ni (prefiks bilan) qamraydi, shuning
// uchun bir turdagi tokenni boshqasi sifatida qayta ishlatib bo'lmaydi (replay yo'q).

/** Session cookie nomi — eski parol-darvozasi `onyx_auth`dan ALOHIDA. */
export const SESSION_COOKIE = "onyx_session";

/**
 * Magic-link tokeni: `magic.<userId>.<expiresAtMs>.<sigHex>`.
 * userId — cuid (nuqtasiz), expiresAtMs — millisekundlar (raqamlar), sig — HMAC hex.
 * Secret yo'q bo'lsa — fail-closed: "" qaytadi (signToken naqshi).
 *
 * ⚠️ HALOLLIK: stateless token DB'siz haqiqiy «bir martalik» bo'la olmaydi —
 * imzo yaroqlik muddati ichida qayta ishlatilishi mumkin. Yumshatuv: 2 daqiqalik
 * qisqa muddat (route real chaqiruvda beradi). Haqiqiy single-use (DB'da ishlatilgan
 * jeton belgisi) — keyingi bosqichga qoldirilgan yaxshilanish.
 */
export async function signMagicLinkToken(
  userId: string,
  expiresAtMs: number,
): Promise<string> {
  const secret = getEnv("AUTH_COOKIE_SECRET");
  if (!secret) {
    console.warn("[auth] AUTH_COOKIE_SECRET o'rnatilmagan — magic-link token yaratib bo'lmadi.");
    return "";
  }
  const payload = `magic.${userId}.${expiresAtMs}`;
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

/**
 * Magic-link tokenini tekshiradi. HECH QACHON throw qilmaydi — tipiklashgan natija.
 * Tartib: shakl → prefiks → imzo (timing-safe) → muddat.
 */
export async function verifyMagicLinkToken(
  token: string,
  nowMs: number,
): Promise<
  | { ok: true; userId: string }
  | { ok: false; reason: "malformed" | "badsig" | "expired" }
> {
  const secret = getEnv("AUTH_COOKIE_SECRET");
  if (!secret) {
    console.warn("[auth] AUTH_COOKIE_SECRET o'rnatilmagan — magic-link token rad etildi.");
    return { ok: false, reason: "badsig" };
  }
  if (!token) return { ok: false, reason: "malformed" };
  // Aynan 4 qism: [prefiks, userId, expiresAtMs, sig]. userId cuid (nuqtasiz),
  // expiresAtMs raqam, sig hex — hech biri nuqta tutmaydi.
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [prefix, userId, expiresAtStr, sig] = parts;
  if (prefix !== "magic") return { ok: false, reason: "malformed" };
  if (!userId || !/^\d+$/.test(expiresAtStr)) {
    return { ok: false, reason: "malformed" };
  }
  const payload = `magic.${userId}.${expiresAtStr}`;
  const expected = await hmacHex(payload, secret);
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: "badsig" };
  const expiresAtMs = Number(expiresAtStr);
  if (nowMs > expiresAtMs) return { ok: false, reason: "expired" };
  return { ok: true, userId };
}

/** Аудит ТЗ №7 #9 — token живёт 30 дней (совпадает с cookie maxAge). */
export const SESSION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Session tokeni v2: `session.<userId>.<expiresAtMs>.<tokenVersion>.<sigHex>`.
 *
 * Аудит ТЗ №7 #9 — раньше payload был `session.<userId>` без времени и версии,
 * поэтому:
 *  • утёкший cookie не истекал по подписи (только по cookie maxAge, который
 *    можно проигнорировать вручную) — фактически бессрочный;
 *  • нельзя было отозвать одну сессию или все сессии пользователя на смене пароля.
 * Теперь imza qamraydi ВСЁ (userId+exp+version), и:
 *  • за пределами `expiresAtMs` — verifySessionToken → null (даже с валидной imza);
 *  • на инкременте User.tokenVersion (смена пароля / "log out everywhere") — все
 *    ранее выпущенные токены становятся неактуальными и отсекаются в session.ts.
 *
 * Secret yo'q bo'lsa — fail-closed ("").
 */
export async function signSessionToken(
  userId: string,
  tokenVersion: number,
  nowMs: number = Date.now(),
  ttlMs: number = SESSION_TOKEN_TTL_MS,
): Promise<string> {
  const secret = getEnv("AUTH_COOKIE_SECRET");
  if (!secret) {
    console.warn("[auth] AUTH_COOKIE_SECRET o'rnatilmagan — session token yaratib bo'lmadi.");
    return "";
  }
  const expiresAtMs = nowMs + ttlMs;
  const payload = `session.${userId}.${expiresAtMs}.${tokenVersion}`;
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

/**
 * Session verifikatsiya natijasi:
 *   ok  → { userId, tokenVersion } — imza yaroqli, muddat o'tmagan.
 *   err → reason: `legacy` (eski 3-qismli token — миграция bosqichi, foydalanuvchi
 *         qайта kirishi shart), `malformed`, `badsig`, `expired`.
 * getCurrentUser (`session.ts`) tokenVersion'ni DB'даги qiymat bilan solishtiradi:
 * farq → null (revoked) — bu ham «qайта kirish talab qilinadi» yo'liga tushadi.
 */
export type SessionVerifyResult =
  | { ok: true; userId: string; tokenVersion: number }
  | { ok: false; reason: "legacy" | "malformed" | "badsig" | "expired" };

/**
 * Session tokenini tekshiradi. HECH QACHON throw qilmaydi.
 * Eski 3-qismli token (session.<userId>.<sig>) → `legacy` — chaqiruvchi (middleware/
 * session.ts) foydalanuvchini login sahifasiga tashlaydi. Migratsiya: eski cookie
 * silently ishlab turmaydi — foydalanuvchi bir marta qayta kirishi shart.
 */
export async function verifySessionToken(
  token: string,
  nowMs: number = Date.now(),
): Promise<SessionVerifyResult> {
  const secret = getEnv("AUTH_COOKIE_SECRET");
  if (!secret) {
    console.warn("[auth] AUTH_COOKIE_SECRET o'rnatilmagan — session token rad etildi.");
    return { ok: false, reason: "badsig" };
  }
  if (!token) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  // v1 legacy (3 qism) — migration: qайта-login talab qilinadi.
  if (parts.length === 3 && parts[0] === "session") {
    return { ok: false, reason: "legacy" };
  }
  // v2: aynan 5 qism [prefiks, userId, expMs, version, sig].
  if (parts.length !== 5) return { ok: false, reason: "malformed" };
  const [prefix, userId, expStr, verStr, sig] = parts;
  if (prefix !== "session" || !userId) return { ok: false, reason: "malformed" };
  if (!/^\d+$/.test(expStr) || !/^\d+$/.test(verStr)) {
    return { ok: false, reason: "malformed" };
  }
  const payload = `session.${userId}.${expStr}.${verStr}`;
  const expected = await hmacHex(payload, secret);
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: "badsig" };
  const expiresAtMs = Number(expStr);
  if (nowMs > expiresAtMs) return { ok: false, reason: "expired" };
  return { ok: true, userId, tokenVersion: Number(verStr) };
}
