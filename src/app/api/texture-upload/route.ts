// ТЗ №20 J (§11.2) — токен для загрузки оригинала текстуры ПРЯМО из браузера
// в Vercel Blob. Зачем: оригинал ≥ 4000 px весит 5–25 МБ, а тело запроса к
// функции Vercel ограничено 4,5 МБ — через server action файл не пролезет.
// Браузер получает здесь одноразовый токен на путь `textures/…` (только JPG,
// до 60 МБ), грузит файл сам, затем вызывает saveUploadedTexture с URL.
//
// /api — вне login-gate (gated-request), поэтому сессию и право проверяем тут.
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/session";
import { capabilitiesFor } from "@/lib/permissions";
import { TEXTURE_MAX_BYTES, TEXTURE_UPLOAD_PREFIX } from "@/lib/textures";

export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  // Только выдача токена: колбэк «загрузка завершена» не используется (запись
  // в БД делает action после загрузки, под сессией сотрудника).
  if (body.type !== "blob.generate-client-token") {
    return Response.json({ error: "unsupported" }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user || !capabilitiesFor(user.role, { canSeePurchasePrice: false }).canUploadTexture) {
    return Response.json({ error: "denied" }, { status: 403 });
  }
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(TEXTURE_UPLOAD_PREFIX) || pathname.includes("..")) {
          throw new Error("bad path");
        }
        return {
          allowedContentTypes: ["image/jpeg"],
          maximumSizeInBytes: TEXTURE_MAX_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
