// OWN-03 — Foydalanuvchi paroli xeshi (PBKDF2, Web Crypto).
// auth.ts allaqachon Web Crypto HMAC ustida qurilgan — shu naqshni takrorlaymiz,
// YANGI npm bog'liqlik YO'Q. Sof, DB'siz, alohida unit-testlanadi.
//
// Format: `pbkdf2$<iter>$<saltB64>$<hashB64>`. Har parol UCHUN tasodifiy tuz
// (crypto.getRandomValues) → bir xil parollar ham turli xesh beradi.
// PBKDF2-SHA256, ≥100k iteratsiya. Xesh 32 bayt (256 bit).
//
// ⚠️ XAVFSIZLIK: ochiq parol HECH QACHON saqlanmaydi/loglanmaydi — faqat xesh.
// verifyUserPassword doimiy-vaqtli (timing-safe) solishtiruv qiladi.

const ALGO = "pbkdf2";
const ITERATIONS = 100_000; // OWASP minimal tavsiyasidan yuqori (SHA-256)
const SALT_BYTES = 16; // 128-bit tuz
const HASH_BYTES = 32; // 256-bit hosila kalit

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** PBKDF2-SHA256 hosila kalit (ArrayBuffer → Uint8Array). */
async function derive(
  plain: string,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number,
): Promise<Uint8Array> {
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      // BufferSource sifatida uzatamiz (Uint8Array).
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/** Doimiy-vaqtli bayt solishtiruv (birinchi farqda chiqib ketmaydi). */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (i < a.length ? a[i] : 0) ^ (i < b.length ? b[i] : 0);
  }
  return diff === 0;
}

/**
 * Ochiq parolni PBKDF2 xeshiga aylantiradi. Har chaqiruvda tasodifiy tuz.
 * Natija: `pbkdf2$100000$<saltB64>$<hashB64>`.
 */
export async function hashUserPassword(plain: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  const hash = await derive(plain, salt, ITERATIONS, HASH_BYTES);
  return `${ALGO}$${ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

/**
 * Ochiq parolni saqlangan xesh bilan tekshiradi. Xesh buzuq/boshqa formatda
 * bo'lsa — false (HECH QACHON throw qilmaydi). Doimiy-vaqtli solishtiruv.
 */
export async function verifyUserPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [algo, iterStr, saltB64, hashB64] = parts;
  if (algo !== ALGO || !/^\d+$/.test(iterStr)) return false;
  const iterations = Number(iterStr);
  if (!(iterations > 0)) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = b64ToBytes(saltB64);
    expected = b64ToBytes(hashB64);
  } catch {
    return false; // yaroqsiz base64
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await derive(plain, salt, iterations, expected.length);
  return timingSafeEqualBytes(actual, expected);
}
