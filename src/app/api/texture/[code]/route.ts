// ТЗ №20 J (§11.2) — «Скачать» текстуру для 3D: ZIP с texture.jpg (оригинал),
// texture_2048.jpg и info.txt, имя `ONX-7K3QD_Travertin-Klassik_280x160.zip`.
// Скачивают партнёр и сотрудники (canDownloadTexture); клиент без входа — нет.
// Каждое скачивание ПАРТНЁРОМ — строка «Интерес: скачал текстуру» в «Заявках».
//
// На Vercel архив лежит в Blob и отдаётся редиректом на ссылку «скачать» (ответ
// функции ограничен 4,5 МБ, а оригинал больше). На своём сервере — байтами.
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { capabilitiesFor } from "@/lib/permissions";
import { loadTextureZip } from "@/lib/texture-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("login required", { status: 401 });
  const caps = capabilitiesFor(user.role, { canSeePurchasePrice: user.canSeePurchasePrice });
  if (!caps.canDownloadTexture) return new Response("forbidden", { status: 403 });

  const zip = await loadTextureZip(db, code);
  if (!zip) return new Response("not found", { status: 404 });

  if (user.role === "PARTNER") {
    try {
      await db.lead.create({
        data: {
          createdById: user.id,
          source: "PARTNER",
          kind: "TEXTURE_DOWNLOAD",
          stoneTypeId: zip.stoneTypeId,
          stoneCode: zip.textureCode,
          status: "NEW",
        },
      });
    } catch (err) {
      // Учёт интереса не должен ломать скачивание.
      console.error("[texture] lead:", err);
    }
  }

  if (zip.downloadUrl) {
    return new Response(null, {
      status: 302,
      headers: { Location: zip.downloadUrl, "Cache-Control": "no-store" },
    });
  }
  return new Response(new Uint8Array(zip.bytes!), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zip.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
