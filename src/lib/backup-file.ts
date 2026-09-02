// Zaxira FAYLI — siqish, shifrlash va sirlarni olib tashlash.
//
// Nega bu alohida modul. Audit 2026-09-02 zaxirada uchta muammo topdi:
//
//   1. Fayl xom JSON edi. Telegram hujjat chegarasi 50 MB; baza o'sganda
//      zaxira shunchaki yuborilmay qo'yardi. JSON ~10 barobar siqiladi —
//      gzip bu muddatni yillarga suradi.
//
//   2. Fayl ichida `User.passwordHash` bor edi va u SHIFRLANMAGAN holda
//      Telegram serverida abadiy yotardi. Parollar PBKDF2 bilan xeshlangan
//      (tez ochilmaydi), lekin oddiy parollar tanlab topiladi. Zaxira
//      himoya bo'lish o'rniga ikkinchi eshikka aylanib qolgandi.
//
//   3. Fayl nomi har doim `.json` edi — tiklash skripti boshqa shaklni
//      umuman tanimasdi.
//
// YECHIM — ikki rejim, kalit bor-yo'qligiga qarab O'ZI tanlanadi:
//
//   BACKUP_ENCRYPTION_KEY berilgan   → gzip + AES-256-GCM shifr.
//                                      Fayl `.json.gz.enc`. Ichida hamma narsa,
//                                      shu jumladan parol xeshlari — chunki
//                                      faylni kalitsiz hech kim ocholmaydi.
//
//   BACKUP_ENCRYPTION_KEY berilmagan → gzip, shifrsiz. Fayl `.json.gz`.
//                                      Parol xeshlari OLIB TASHLANADI:
//                                      shifrlanmagan faylda ular yotmasin.
//                                      Bunday zaxiradan tiklaganda xodimlar
//                                      parolini qayta o'rnatish kerak bo'ladi
//                                      (`npm run seed:owner`), qolgan hamma
//                                      ma'lumot joyida.
//
// Ya'ni sozlamaga tegmasa ham zaxira XAVFSIZ bo'lib qoladi, kalit qo'shilsa —
// to'liq bo'ladi. Kalitni yo'qotmaslik kerak: usiz eski fayllar ochilmaydi.
//
// Fayl shakli (shifrlangan):
//   "ONYXENC1" (8 bayt) | salt (16) | iv (12) | tag (16) | shifrlangan gzip
// Sarlavha ochiq — tiklash skripti faylni ochmasdan turib shaklini bilishi kerak.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type { Snapshot } from "./db-snapshot";

/** Shifrlangan faylning boshidagi belgi — shaklni fayl ochmasdan aniqlash uchun. */
export const ENC_MAGIC = "ONYXENC1";
const ENC_MAGIC_BYTES = Buffer.from(ENC_MAGIC, "ascii");
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

/** gzip faylining birinchi ikki bayti — shu bilan `.json.gz` tanib olinadi. */
const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * Kalit qisqa bo'lsa shifr zaif bo'ladi, shuning uchun pastki chegara.
 * Bu parol-ibora (passphrase): scrypt uni 32 baytga cho'zadi.
 */
export const MIN_KEY_LENGTH = 16;

export type BackupEnv = Record<string, string | undefined>;

/**
 * Shifrlash kaliti bormi. Bo'sh yoki juda qisqa bo'lsa — YO'Q deb hisoblanadi
 * (jimgina zaif shifrdan ko'ra ochiq-oydin shifrsiz rejim yaxshi: u holda
 * parol xeshlari olib tashlanadi).
 */
export function resolveBackupKey(env: BackupEnv = process.env): string | null {
  const raw = (env.BACKUP_ENCRYPTION_KEY ?? "").trim();
  if (raw.length < MIN_KEY_LENGTH) return null;
  return raw;
}

/**
 * Shifrsiz zaxiradan olib tashlanadigan maydonlar.
 * Jadval → ustunlar. Yangi sir qo'shilsa shu yerga yoziladi.
 */
export const REDACTED_FIELDS: Record<string, string[]> = {
  user: ["passwordHash"],
};

export interface RedactResult {
  snapshot: Snapshot;
  /** `user.passwordHash` ko'rinishidagi ro'yxat — faylning ichiga ham yoziladi. */
  removed: string[];
}

/**
 * Sirlarni olib tashlaydi. Yozuvning O'ZI qoladi (id, email, rol, ism) —
 * faqat maydon qiymati `null` bo'ladi, ya'ni tiklashda hisob tiklanadi,
 * lekin parolsiz. `passwordHash` sxemada nullable, shuning uchun bu xavfsiz.
 *
 * Sof funksiya: kirish obyektiga tegmaydi, yangisini qaytaradi.
 */
export function redactSecrets(snapshot: Snapshot): RedactResult {
  const removed: string[] = [];
  const rows: Record<string, unknown[]> = { ...snapshot.rows };

  for (const [table, fields] of Object.entries(REDACTED_FIELDS)) {
    const original = snapshot.rows[table];
    if (!Array.isArray(original) || original.length === 0) continue;
    let touched = false;
    const cleaned = original.map((row) => {
      if (row === null || typeof row !== "object") return row;
      const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
      for (const f of fields) {
        if (copy[f] !== null && copy[f] !== undefined) {
          copy[f] = null;
          touched = true;
        }
      }
      return copy;
    });
    if (touched) {
      rows[table] = cleaned;
      for (const f of fields) removed.push(`${table}.${f}`);
    }
  }

  return { snapshot: { ...snapshot, rows }, removed };
}

export interface PackedBackup {
  bytes: Buffer;
  /** Fayl nomi (kengaytmasi rejimga qarab). */
  filename: string;
  encrypted: boolean;
  /** Shifrsiz rejimda olib tashlangan maydonlar (bo'sh bo'lishi mumkin). */
  redacted: string[];
}

/** `onyx-backup-2026-09-02.json.gz` — sana bo'yicha saralanadigan nom. */
export function backupFilename(takenAtIso: string, encrypted: boolean): string {
  const day = takenAtIso.slice(0, 10);
  return `onyx-backup-${day}.json.gz${encrypted ? ".enc" : ""}`;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // scrypt — parol-iborani kalitga aylantirish uchun. N=2^15: bir marta
  // hisoblash ~100 ms, ya'ni tanlab topish qimmat, zaxira esa shoshilmaydi.
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
}

/**
 * Snapshot'ni yuboriladigan faylga aylantiradi.
 *
 * Kalit berilsa — hamma narsa ichida qoladi va shifrlanadi.
 * Kalit berilmasa — avval sirlar olib tashlanadi, keyin siqiladi.
 */
export function packBackup(
  snapshot: Snapshot,
  toJson: (s: Snapshot) => string,
  key: string | null,
): PackedBackup {
  const encrypted = key !== null;
  let redacted: string[] = [];
  let source = snapshot;

  if (!encrypted) {
    const r = redactSecrets(snapshot);
    source = r.snapshot;
    redacted = r.removed;
    if (redacted.length > 0) {
      // Faylni ochgan odam nima yo'qligini KO'RSIN — «tiklandi, lekin kira
      // olmayapman» degan hayratni oldini oladi.
      source = { ...source, redacted } as Snapshot & { redacted: string[] };
    }
  }

  const gz = gzipSync(Buffer.from(toJson(source), "utf8"), { level: 9 });
  const filename = backupFilename(snapshot.takenAt, encrypted);

  if (!encrypted) {
    return { bytes: gz, filename, encrypted: false, redacted };
  }

  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(key as string, salt), iv);
  const body = Buffer.concat([cipher.update(gz), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    bytes: Buffer.concat([ENC_MAGIC_BYTES, salt, iv, tag, body]),
    filename,
    encrypted: true,
    redacted: [],
  };
}

export type BackupFormat = "enc" | "gzip" | "plain";

/** Fayl shaklini bosh baytlaridan aniqlaydi — kengaytmaga ishonmaymiz. */
export function detectFormat(bytes: Buffer): BackupFormat {
  if (bytes.length >= ENC_MAGIC_BYTES.length && bytes.subarray(0, ENC_MAGIC_BYTES.length).equals(ENC_MAGIC_BYTES)) {
    return "enc";
  }
  if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]) {
    return "gzip";
  }
  return "plain";
}

export class BackupKeyError extends Error {}

/**
 * Faylni JSON matnga qaytaradi. Uchala shaklni ham tushunadi, shu jumladan
 * ESKI shifrsiz `.json` fayllarni — eski zaxiralar ishlashda davom etsin.
 */
export function unpackBackup(bytes: Buffer, key: string | null): string {
  const format = detectFormat(bytes);

  if (format === "plain") return bytes.toString("utf8");
  if (format === "gzip") return gunzipSync(bytes).toString("utf8");

  if (key === null) {
    throw new BackupKeyError(
      "Fayl shifrlangan. BACKUP_ENCRYPTION_KEY bering — u zaxira olingan paytdagi kalit bilan AYNAN bir xil bo'lishi kerak.",
    );
  }

  let off = ENC_MAGIC_BYTES.length;
  const salt = bytes.subarray(off, (off += SALT_LEN));
  const iv = bytes.subarray(off, (off += IV_LEN));
  const tag = bytes.subarray(off, (off += TAG_LEN));
  const body = bytes.subarray(off);
  if (salt.length !== SALT_LEN || iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new BackupKeyError("Shifrlangan fayl buzilgan: sarlavha to'liq emas.");
  }

  const decipher = createDecipheriv("aes-256-gcm", deriveKey(key, salt), iv);
  decipher.setAuthTag(tag);
  let gz: Buffer;
  try {
    gz = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // GCM tegi mos kelmadi: yo kalit boshqa, yo fayl o'zgartirilgan.
    // Ikkalasi ham bir xil darajada muhim — farqini aytib bo'lmaydi.
    throw new BackupKeyError(
      "Faylni ochib bo'lmadi: kalit noto'g'ri yoki fayl o'zgartirilgan.",
    );
  }
  return gunzipSync(gz).toString("utf8");
}
