// ТЗ №20 J (§11.3) — превью текстуры 2048 px для 3D-сцены. Открыто (клиент в
// шоу-руме и по QR без входа): превью — та же витрина, что фото камня. Отдаём
// байты с нашего домена, а не редирект: WebGL-текстура с чужого домена
// требует CORS, а так картинка всегда «своя». ?v= меняется при замене
// текстуры, поэтому кэш — навсегда.
import { db } from "@/lib/db";
import { readStorageBytes } from "@/lib/storage/photo-storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tex = await db.stoneTexture.findUnique({
    where: { id },
    select: { previewKey: true },
  });
  if (!tex) return new Response("not found", { status: 404 });
  const bytes = await readStorageBytes(tex.previewKey);
  if (!bytes) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "CDN-Cache-Control": "public, s-maxage=31536000",
    },
  });
}
