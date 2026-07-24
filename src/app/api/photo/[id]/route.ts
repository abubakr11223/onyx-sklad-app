// Rasm proksisi (TG-B2). storageKey = Telegram file_id. Bu endpoint file_id
// bo'yicha getFile → file_path oladi, so'ng downloadFile bilan baytlarni qaytaradi.
// Rasmni o'zimiz saqlamaymiz — talab bo'yicha Telegram'dan. Ochiq GET.
//
// BATCH-B (perf): rasm mazmuni id bo'yicha O'ZGARMAS — shuning uchun uzoq muddatli
// CDN kesh (bir viewer'ga bir marta Telegram'dan olinadi, keyin CDN'dan). `dynamic`
// force-dynamic OLIB TASHLANDI: keshni sarlavhalar boshqaradi, handler cache-miss'da
// baribir dinamik ishlaydi (DB + tashqi fetch). Content-Type file_path kengaytmasidan
// (png/jpeg/webp) — hardcoded jpeg emas.
// DEFER: baytlar hali ham to'liq buferlanadi (streaming — telegram.ts downloadFile'ni
// o'zgartirishni talab qiladi, u bu batch lock'ida emas). Kichik thumbnail saqlash ham
// webhook o'zgarishini talab qiladi (kelgusi batch).
import { db } from "@/lib/db";
import { downloadFile, getFile } from "@/lib/telegram";

/** file_path kengaytmasidan MIME (Telegram jpeg/png/webp beradi). */
function contentTypeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params; // Next 16: params — Promise.

  const photo = await db.photo.findUnique({
    where: { id },
    select: { storageKey: true },
  });
  if (!photo) {
    return new Response("not found", { status: 404 });
  }

  // §6.7 «B» — AI-интерьеры хранятся в Vercel Blob: storageKey = публичный URL
  // (а не Telegram file_id). Отдаём редиректом на blob (сам кэшируется CDN).
  if (/^https?:\/\//.test(photo.storageKey)) {
    return Response.redirect(photo.storageKey, 308);
  }

  // storageKey — Telegram file_id. Token yo'q bo'lsa getFile null qaytaradi →
  // yiqilmasdan 404. file_path olishda xato bo'lsa ham 404.
  let file;
  try {
    file = await getFile(photo.storageKey);
  } catch {
    return new Response("upstream error", { status: 502 });
  }
  if (!file?.file_path) {
    return new Response("not found", { status: 404 });
  }

  let bytes;
  try {
    bytes = await downloadFile(file.file_path);
  } catch {
    return new Response("upstream error", { status: 502 });
  }
  if (!bytes) {
    return new Response("not found", { status: 404 });
  }

  // Uint8Array<ArrayBufferLike> — BodyInit sifatida qabul qilinadi (runtime OK),
  // lekin DOM lib tipi SharedArrayBuffer'ni istisno qilmagani uchun cast qilamiz.
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": contentTypeFromPath(file.file_path),
      // Brauzer keshi + CDN keshi (Vercel): id bo'yicha mazmun o'zgarmas.
      "Cache-Control": "public, max-age=31536000, immutable",
      "CDN-Cache-Control": "public, s-maxage=31536000",
    },
  });
}
