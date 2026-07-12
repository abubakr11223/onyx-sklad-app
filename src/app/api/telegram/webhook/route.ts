// Telegram webhook route (TG-A). setWebhook'da berilgan maxfiy satr
// `x-telegram-bot-api-secret-token` sarlavhasida keladi — uni timing-safe
// solishtiramiz (auth.ts naqshi). Auth o'tsa update handler chaqiriladi va
// DOIM 200 qaytadi (Telegram qayta urmasligi uchun). Auth xatosi → 401.
import { signMagicLinkToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendMessage } from "@/lib/telegram";
import type { TgUpdate } from "@/lib/telegram";
import { handleUpdate } from "@/lib/telegram-webhook";

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
  });
  return Response.json({ ok: true });
}
