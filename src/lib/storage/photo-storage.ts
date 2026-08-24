// Rasm ombori — DRAYVER ortida. Loyiha oxirida EGANING O'Z SERVERIGA ko'chadi,
// shuning uchun hech bir modul to'g'ridan-to'g'ri Vercel Blob'ga bog'lanmaydi:
// ombor bitta muhit o'zgaruvchisi bilan almashadi.
//
//   PHOTO_STORAGE=vercel-blob   → hozirgi vaqtinchalik holat (Vercel Blob)
//   PHOTO_STORAGE=local         → o'z serveri: fayl diskda (Docker volume)
//   PHOTO_STORAGE berilmagan    → BLOB_READ_WRITE_TOKEN bor bo'lsa vercel-blob,
//                                 aks holda local (VPS'da o'zi to'g'ri tanlaydi)
//
// ── storageKey'ning UCH shakli (Photo.storageKey) ──
//   1) `https://…`      — Vercel Blob (yoki boshqa tashqi URL). Eski yozuvlar.
//   2) `local:sub/dir/x.jpg` — o'z diskimiz, PHOTO_STORAGE_DIR ichida.
//   3) boshqa hamma narsa — Telegram file_id (bot orqali kelgan rasmlar).
//
// Uchalasi BIR VAQTDA yashaydi: ombor almashtirilganda ESKI yozuvlar buzilmaydi,
// chunki har bir kalit o'z shaklini o'zi aytib turadi. Ko'chirishda faqat yangi
// rasmlar yangi omborga tushadi; eskilarini ko'chirish — alohida skript ishi.
//
// ⚠️ Telegram file_id — bu bizning ombor EMAS: baytlar Telegram serverida.
// Bot tokeni saqlansa ko'chishdan keyin ham ochiladi, lekin to'liq mustaqillik
// uchun ularni bir kun o'z omborimizga ko'chirish kerak (alohida vazifa).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export type StorageDriver = "vercel-blob" | "local";

/**
 * Muhit o'zgaruvchilari — `StorageEnv` emas, sodda xarita. Sabab: loyiha
 * tipida NODE_ENV majburiy, testda esa bitta kalitli obyekt berish qulay
 * (muhitni butunlay o'zgartirmasdan). process.env shu tipga to'g'ri tushadi.
 */
export type StorageEnv = Record<string, string | undefined>;

/** `local:` prefiksi — kalit o'z diskimizdagi faylni ko'rsatadi. */
export const LOCAL_PREFIX = "local:";

/** Standart papka: Docker'da volume shu yerga ulanadi (docker-compose.prod.yml). */
export const DEFAULT_LOCAL_DIR = "/data/photos";

/**
 * Qaysi drayver ishlaydi. Sof funksiya (env argument bilan) — testda muhitni
 * o'zgartirmasdan tekshiriladi.
 */
export function resolveDriver(
  env: StorageEnv = process.env,
): StorageDriver {
  const explicit = (env.PHOTO_STORAGE ?? "").trim().toLowerCase();
  if (explicit === "local") return "local";
  if (explicit === "vercel-blob" || explicit === "vercel") return "vercel-blob";
  // Aniq ko'rsatilmagan: token bor bo'lsa Blob, yo'q bo'lsa disk. Shu tufayli
  // VPS'da hech narsa sozlamasa ham to'g'ri ishlaydi.
  return env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local";
}

/** Disk ildizi (PHOTO_STORAGE_DIR yoki standart). */
export function localRoot(env: StorageEnv = process.env): string {
  const dir = (env.PHOTO_STORAGE_DIR ?? "").trim();
  return dir.length > 0 ? dir : DEFAULT_LOCAL_DIR;
}

/** MIME → fayl kengaytmasi (photo-blob.ts dagi bilan bir xil qoida). */
export function extFromMime(mime: string): "png" | "webp" | "jpg" {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

/** Kengaytmadan MIME — diskdan yoki Telegram'dan berishda ishlatiladi. */
export function contentTypeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

/** Tashqi URL (Vercel Blob va h.k.)? */
export function isRemoteUrl(storageKey: string): boolean {
  return /^https?:\/\//.test(storageKey);
}

/** O'z diskimizdagi fayl? */
export function isLocalKey(storageKey: string): boolean {
  return storageKey.startsWith(LOCAL_PREFIX);
}

/**
 * `local:` kalitidan XAVFSIZ nisbiy yo'l. null — kalit yaroqsiz.
 *
 * Nega qattiq tekshiruv: kalit bazadan keladi, ya'ni bir kun noto'g'ri yozuv
 * (yoki qo'lda tahrir) `local:../../etc/passwd` bo'lib qolishi mumkin. Bunday
 * yo'l ildizdan chiqmasligi kerak — path traversal'ni shu yerda yopamiz.
 */
export function localKeyToRelPath(storageKey: string): string | null {
  if (!isLocalKey(storageKey)) return null;
  const raw = storageKey.slice(LOCAL_PREFIX.length).trim();
  if (raw.length === 0) return null;
  if (raw.startsWith("/") || raw.startsWith("\\")) return null;
  if (/^[a-zA-Z]:/.test(raw)) return null; // Windows disk harfi
  if (raw.includes("\0")) return null;
  const parts = raw.split(/[\\/]+/);
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts.join("/");
}

/**
 * Kalitdan to'liq disk yo'li. Ildizdan chiqib ketgan yo'l → null (ikki qatlamli
 * himoya: yuqoridagi tekshiruvdan tashqari, natijani ildiz bilan solishtiramiz).
 */
export function localKeyToAbsPath(
  storageKey: string,
  env: StorageEnv = process.env,
): string | null {
  const rel = localKeyToRelPath(storageKey);
  if (rel === null) return null;
  const root = resolve(localRoot(env));
  const abs = resolve(join(root, rel));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

/** `patterns/b1/p1-123` + `image/png` → `patterns/b1/p1-123.png`. */
export function objectPath(pathPrefix: string, mediaType: string): string {
  return `${pathPrefix}.${extFromMime(mediaType)}`;
}

export interface PutObjectParams {
  /** Ombor ichidagi yo'l prefiksi (kengaytmasiz). */
  pathPrefix: string;
  bytes: Buffer;
  mediaType: string;
}

export interface PutObjectResult {
  /** Photo.storageKey sifatida yoziladigan qiymat. */
  storageKey: string;
  mediaType: string;
}

/**
 * Diskka yozish. Papkalar avtomatik yaratiladi. Kalit — `local:...` shaklida,
 * ya'ni o'qish paytida qayerdan olishni kalitning o'zi aytadi.
 */
export async function putLocalObject(
  params: PutObjectParams,
  env: StorageEnv = process.env,
): Promise<PutObjectResult> {
  const rel = objectPath(params.pathPrefix, params.mediaType);
  const key = LOCAL_PREFIX + rel;
  const abs = localKeyToAbsPath(key, env);
  if (abs === null) {
    throw new Error(`Yaroqsiz rasm yo'li: ${params.pathPrefix}`);
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, params.bytes);
  return { storageKey: key, mediaType: params.mediaType };
}

/** Diskdan o'qish. Fayl yo'q/o'qilmasa — null (route 404 beradi). */
export async function readLocalObject(
  storageKey: string,
  env: StorageEnv = process.env,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const abs = localKeyToAbsPath(storageKey, env);
  if (abs === null) return null;
  try {
    const buf = await readFile(abs);
    return { bytes: new Uint8Array(buf), contentType: contentTypeFromPath(abs) };
  } catch {
    return null;
  }
}

/**
 * Drayverga qarab yozadi. `@vercel/blob` faqat KERAK BO'LGANDA import qilinadi
 * (dinamik import): o'z serverida bu paket umuman chaqirilmaydi va uning tokeni
 * ham talab qilinmaydi.
 */
export async function putPhotoObject(
  params: PutObjectParams,
  env: StorageEnv = process.env,
): Promise<PutObjectResult> {
  if (resolveDriver(env) === "local") {
    return putLocalObject(params, env);
  }
  const { put } = await import("@vercel/blob");
  const blob = await put(objectPath(params.pathPrefix, params.mediaType), params.bytes, {
    access: "public",
    contentType: params.mediaType,
  });
  return { storageKey: blob.url, mediaType: params.mediaType };
}
