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
