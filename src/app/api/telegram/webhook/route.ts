// Telegram webhook route (TG-A). setWebhook'da berilgan maxfiy satr
// `x-telegram-bot-api-secret-token` sarlavhasida keladi — uni timing-safe
// solishtiramiz (auth.ts naqshi). Auth o'tsa update handler chaqiriladi va
// DOIM 200 qaytadi (Telegram qayta urmasligi uchun). Auth xatosi → 401.
import { signMagicLinkToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { downloadFile, getFile, sendMessage } from "@/lib/telegram";
import type { TgUpdate } from "@/lib/telegram";
import { handleUpdate } from "@/lib/telegram-webhook";
import { analyzeBrokenStoneShape } from "@/lib/ai-shape";
import { separateSlabGuarded } from "@/lib/slab-separation";

export const dynamic = "force-dynamic";

/**
 * Doimiy vaqtli satr solishtirish (auth.ts'dagi bilan bir xil naqsh).
 * Uzunlik farqi ham hisobga olinadi; birinchi farqda chiqib ketmaydi.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ (i < bBytes.length ? bBytes[i] : 0);
  }
  return diff === 0;
}

/** Sarlavha maxfiy satri to'g'ri kelsa true. Secret o'rnatilmagan → false (fail-closed). */
function isAuthorized(req: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || expected.length === 0) {
    console.warn("[telegram-webhook] TELEGRAM_WEBHOOK_SECRET o'rnatilmagan — rad etildi.");
    return false;
  }
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return timingSafeEqual(got, expected);
}

/**
 * §5.5b — real rasm-yuklovchi: file_id → getFile → downloadFile → base64.
 * Media turi file_path kengaytmasidan (.png → image/png, qolgani jpeg —
 * Telegram photo'lari amalda jpeg). Xatoda null (handler halol xabar beradi).
 */
async function downloadPhotoBase64(
  fileId: string,
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" } | null> {
  const file = await getFile(fileId);
  if (!file?.file_path) return null;
  const bytes = await downloadFile(file.file_path);
  if (!bytes) return null;
  const mediaType = file.file_path.toLowerCase().endsWith(".png")
    ? ("image/png" as const)
    : ("image/jpeg" as const);
  return { base64: Buffer.from(bytes).toString("base64"), mediaType };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // Auth o'tdi — nima bo'lsa ham 200 qaytamiz (handler o'zi xatolarni yutadi).
  // SK-4b: magic-link imzolovchisi + bazaviy URL inyeksiya qilinadi.
  await handleUpdate(update, {
    db,
    sendMessage,
    signMagicLinkToken,
    appBaseUrl: process.env.APP_BASE_URL ?? "",
    // §5.5b — singan tosh: real yuklovchi + real AI-shakl aniqlovchi.
    downloadPhotoBase64,
    analyzeShape: (imageBase64, mediaType) =>
      analyzeBrokenStoneShape(imageBase64, mediaType),
    // Аудит ТЗ №7 #1 — выделение плиты в транзакции с batch-lock + guard §3.
    separateSlab: (input) => separateSlabGuarded(input),
  });
  return Response.json({ ok: true });
}
