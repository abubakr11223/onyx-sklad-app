// Rasmlarni bazadan TASHQARIGA nusxalash — zaxiraning ikkinchi yarmi.
//
// MUAMMO (audit 2026-09-02, eng og'ir topilma). Kunlik JSON zaxirada har
// rasmning faqat MANZILI bor, rasmning O'ZI yo'q. Baytlar uchta boshqa joyda
// yotadi: Vercel Blob'da (`https://…`), Telegram serverida (bot file_id) yoki
// bizning diskimizda (`local:…`). Ya'ni bazani tiklagandan keyin ombordagi
// HAR BIR surat ochilmaydigan havolaga aylanadi. Sotilgan yoki jo'natilgan
// toshni qayta suratga olib bo'lmaydi — bu qaytmas yo'qotish.
//
// BU SKRIPT nima qiladi: hamma rasmni bitta papkaga yig'adi va yoniga
// `manifest.json` yozadi (qaysi fayl qaysi rasm, qaysi partiyaga tegishli).
// Papkani tashqi diskka yoki boshqa bulutga ko'chirsangiz — rasmlar zaxirasi
// tayyor bo'ladi.
//
//   npm run backup:photos -- --out=/srv/backups/photos
//
// TAKROR YURGIZISH ARZON: allaqachon ko'chirilgan rasm qayta yuklanmaydi
// (manifest va fayl hajmi bo'yicha tekshiriladi). Shuning uchun uni kuniga
// bir marta cron'ga qo'yish mumkin — birinchi yurgizish uzoq, keyingilari tez.
//
// BAYROQLAR:
//   --out=<papka>   majburiy — rasmlar shu yerga tushadi
//   --limit=<N>     faqat N ta rasm (sinash uchun)
//   --force         allaqachon bor fayllarni ham qayta yuklash
//   --quiet         har bir fayl uchun qator chiqarmaslik
//
// KO'CHIRISHDA: bu skript Vercel akkauntini YOPISHDAN OLDIN yurgizilishi shart —
// aks holda `https://…` manzillaridagi rasmlar bir yo'la yo'qoladi. Tafsilot:
// docs/zaxira.md.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { downloadFile, getFile } from "../src/lib/telegram";
import {
  contentTypeFromPath,
  isLocalKey,
  isRemoteUrl,
  readLocalObject,
} from "../src/lib/storage/photo-storage";

interface Args {
  out: string | null;
  limit: number | null;
  force: boolean;
  quiet: boolean;
}

export function parseArgs(argv: string[]): Args {
  let out: string | null = null;
  let limit: number | null = null;
  let force = false;
  let quiet = false;
  for (const a of argv) {
    if (a.startsWith("--out=")) out = a.slice("--out=".length) || null;
    else if (a.startsWith("--limit=")) {
      const n = Number.parseInt(a.slice("--limit=".length), 10);
      limit = Number.isFinite(n) && n > 0 ? n : null;
    } else if (a === "--force") force = true;
    else if (a === "--quiet") quiet = true;
  }
  return { out, limit, force, quiet };
}

/** `image/jpeg` → `jpg`. Nomaʼlum tur — `bin`, fayl baribir saqlanadi. */
export function extFromContentType(ct: string): string {
  const t = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  if (t === "image/jpeg" || t === "image/jpg") return "jpg";
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/gif") return "gif";
  if (t === "application/pdf") return "pdf";
  return "bin";
}

/** `2026-08` — oylik papkalar: bitta katalogda o'n minglab fayl bo'lmasin. */
export function monthDir(iso: Date): string {
  return `${iso.getUTCFullYear()}-${String(iso.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Source = "local" | "url" | "telegram";

interface ManifestEntry {
  file: string;
  bytes: number;
  sha256: string;
  kind: string;
  source: Source;
  storageKey: string;
  takenAt: string;
  batchId: string | null;
  slabId: string | null;
  pieceId: string | null;
  stoneTypeId: string | null;
  copiedAt: string;
}

type Manifest = Record<string, ManifestEntry>;

/** Rasm baytlarini uchta manbadan qidiradi. Topolmasa — null (yiqilmaydi). */
async function fetchBytes(
  storageKey: string,
): Promise<{ bytes: Uint8Array; contentType: string; source: Source } | null> {
  if (isLocalKey(storageKey)) {
    const obj = await readLocalObject(storageKey);
    return obj ? { ...obj, source: "local" } : null;
  }

  if (isRemoteUrl(storageKey)) {
    try {
      const res = await fetch(storageKey);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const ct = res.headers.get("content-type") ?? contentTypeFromPath(storageKey);
      return { bytes: buf, contentType: ct, source: "url" };
    } catch {
      return null;
    }
  }

  // Qolgani — Telegram file_id. DIQQAT: Telegram file_id'lari abadiy emas va
  // fayl BIZNING omborimizda emas. Aynan shuning uchun ularni o'zimizga
  // tortib olish kerak.
  const file = await getFile(storageKey);
  if (!file?.file_path) return null;
  const bytes = await downloadFile(file.file_path);
  if (!bytes) return null;
  return { bytes, contentType: contentTypeFromPath(file.file_path), source: "telegram" };
}

function loadManifest(path: string): Manifest {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const m = parsed as { photos?: unknown };
      if (m.photos && typeof m.photos === "object") return m.photos as Manifest;
    }
  } catch {
    console.warn("⚠️  manifest.json o'qilmadi — noldan boshlanadi.");
  }
  return {};
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error("⛔ --out=<papka> ko'rsatilmadi.\n");
    console.error("Misol:");
    console.error("  npm run backup:photos -- --out=/srv/backups/photos\n");
    console.error("Papka bo'sh bo'lishi shart emas: allaqachon ko'chirilgan");
    console.error("rasmlar qayta yuklanmaydi.");
    process.exitCode = 1;
    return;
  }

  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const manifestPath = join(outDir, "manifest.json");
  const manifest = loadManifest(manifestPath);

  const db = new PrismaClient();
  let copied = 0;
  let skipped = 0;
  const missing: { id: string; storageKey: string }[] = [];

  try {
    const photos = await db.photo.findMany({
      orderBy: { createdAt: "asc" },
      ...(args.limit ? { take: args.limit } : {}),
      select: {
        id: true,
        storageKey: true,
        kind: true,
        takenAt: true,
        batchId: true,
        slabId: true,
        pieceId: true,
        stoneTypeId: true,
      },
    });

    console.log(`Bazada ${photos.length} ta rasm. Papka: ${outDir}`);
    console.log("");

    for (const p of photos) {
      const prev = manifest[p.id];
      if (prev && !args.force) {
        const abs = join(outDir, prev.file);
        // Fayl haqiqatan joyidami va hajmi mos keladimi — manifestga
        // ko'r-ko'rona ishonmaymiz (disk to'lib qolishi mumkin edi).
        if (existsSync(abs) && statSync(abs).size === prev.bytes) {
          skipped += 1;
          continue;
        }
      }

      const got = await fetchBytes(p.storageKey);
      if (!got) {
        missing.push({ id: p.id, storageKey: p.storageKey.slice(0, 60) });
        if (!args.quiet) console.warn(`  ✗ ${p.id} — baytlar topilmadi`);
        continue;
      }

      const rel = join(monthDir(p.takenAt), `${p.id}.${extFromContentType(got.contentType)}`);
      const abs = join(outDir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, got.bytes);

      manifest[p.id] = {
        file: rel,
        bytes: got.bytes.length,
        sha256: createHash("sha256").update(got.bytes).digest("hex"),
        kind: String(p.kind),
        source: got.source,
        storageKey: p.storageKey,
        takenAt: p.takenAt.toISOString(),
        batchId: p.batchId,
        slabId: p.slabId,
        pieceId: p.pieceId,
        stoneTypeId: p.stoneTypeId,
        copiedAt: new Date().toISOString(),
      };
      copied += 1;
      if (!args.quiet) console.log(`  ✓ ${rel}  (${got.source}, ${got.bytes.length} b)`);

      // Manifest har 25 ta rasmdan keyin saqlanadi: uzilib qolsa ham
      // qilingan ish yo'qolmaydi va keyingi yurgizish o'sha joydan davom etadi.
      if (copied % 25 === 0) writeManifest(manifestPath, manifest);
    }
  } finally {
    writeManifest(manifestPath, manifest);
    await db.$disconnect();
  }

  const totalBytes = Object.values(manifest).reduce((a, e) => a + e.bytes, 0);
  console.log("");
  console.log(`✅ Yangi ko'chirildi: ${copied}`);
  console.log(`   O'tkazib yuborildi (allaqachon bor): ${skipped}`);
  console.log(`   Papkada jami: ${Object.keys(manifest).length} rasm, ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`   Manifest: ${manifestPath}`);

  if (missing.length > 0) {
    console.log("");
    console.warn(`⚠️  ${missing.length} ta rasmning baytlari topilmadi.`);
    console.warn("   Sabablari: Telegram file_id eskirgan, tashqi manzil o'chirilgan,");
    console.warn("   yoki bot tokeni yo'q. Bu rasmlar zaxirada YO'Q — ularni");
    console.warn("   qayta suratga olishdan boshqa yo'l qolmaydi.");
    for (const m of missing.slice(0, 20)) console.warn(`     ${m.id}  ${m.storageKey}`);
    if (missing.length > 20) console.warn(`     … va yana ${missing.length - 20} ta`);
    // Chiqish kodi 0 EMAS: cron logi qizil bo'lsin, aks holda yo'qolgan
    // rasmlar jimgina o'tib ketadi.
    process.exitCode = 2;
  }
}

function writeManifest(path: string, photos: Manifest): void {
  writeFileSync(
    path,
    JSON.stringify(
      { version: 1, updatedAt: new Date().toISOString(), count: Object.keys(photos).length, photos },
      null,
      1,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
