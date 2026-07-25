// §5.9 — Telegram Mini App аутентификация. Клиент (стр. /tg) шлёт initData из
// window.Telegram.WebApp.initData; здесь проверяем подпись Telegram, находим
// пользователя по telegramId и ставим onyx_session cookie (как /login/tg).
// initData подписан ботом — подделать без TELEGRAM_BOT_TOKEN нельзя.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signSessionToken } from "@/lib/auth";
import { validateTelegramInitData } from "@/lib/telegram-webapp";
import { TELEGRAM_INIT_DATA_TTL_SEC } from "@/lib/config";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function POST(req: Request): Promise<Response> {
  const fail = (reason: string) =>
    NextResponse.json({ ok: false, reason }, { status: 401 });

  let initData = "";
  try {
    const body = (await req.json()) as { initData?: unknown };
    initData = typeof body.initData === "string" ? body.initData : "";
  } catch {
    return fail("malformed");
  }

  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  // Аудит ТЗ №7 #24 — раньше здесь работал дефолт 24 ч, что для минтинга
  // 30-дневной cookie слишком широкое окно replay'а. Явно 1 час.
  const res = await validateTelegramInitData(
    initData,
    token,
    Date.now(),
    TELEGRAM_INIT_DATA_TTL_SEC,
  );
  if (!res.ok) return fail(res.reason);

  // Пользователь должен существовать (привязан telegramId) и быть активным.
  // Аудит ТЗ №7 #9 — tokenVersion в session-токене (revoke на смене пароля).
  const user = await db.user.findFirst({
    where: { telegramId: res.telegramId, isActive: true },
    select: { id: true, tokenVersion: true },
  });
  if (!user) return fail("not_registered");

  const sessionToken = await signSessionToken(user.id, user.tokenVersion);
  if (!sessionToken) return fail("nosecret");

  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: THIRTY_DAYS,
  });
  return out;
}
