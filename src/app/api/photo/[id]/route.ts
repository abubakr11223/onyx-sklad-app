// Rasm proksisi (TG-B2). storageKey = Telegram file_id. Bu endpoint file_id
// bo'yicha getFile → file_path oladi, so'ng downloadFile bilan baytlarni oqim
// qilib qaytaradi. Rasmni o'zimiz saqlamaymiz — talab bo'yicha Telegram'dan.
// Ochiq GET (thumbnail'lar <img src> orqali yuklanadi).
import { db } from "@/lib/db";
import { downloadFile, getFile } from "@/lib/telegram";

export const dynamic = "force-dynamic";

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
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
