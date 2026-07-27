// SK-4b — Telegram magic-link login qabul qiluvchi (GET).
// Foydalanuvchi Telegram'da kelgan `/login/tg?token=…` havolasini ochadi.
// Token yaroqli va muddati o'tmagan bo'lsa — imzolangan `onyx_session` cookie'si
// o'rnatiladi va `/` ga yo'naltiriladi. Aks holda — `/login?error=magic`.
// HECH QACHON foydalanuvchiga throw qilmaydi; xato sababi OSHKOR ETILMAYDI.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signSessionToken, verifyMagicLinkToken } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  consumeMagicLinkJti,
  pruneExpiredMagicJti,
} from "@/lib/magic-link-store";

export const dynamic = "force-dynamic";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = url.origin;
  const failRedirect = () =>
    NextResponse.redirect(new URL("/login?error=magic", origin));

  try {
    const token = url.searchParams.get("token") ?? "";
    const result = await verifyMagicLinkToken(token, Date.now());
    if (!result.ok) {
      // Sabab (malformed/badsig/expired/legacy) oshkor etilmaydi — yagona xato branch'i.
      return failRedirect();
    }

    // Аудит ТЗ №7 #10 — single-use: пометим jti как истраченный ДО создания
    // сессии. Второй клик по той же ссылке (Telegram forward / proxy log) не
    // получит сессию. Ошибка/replay — единый ?error=magic (сабаб оshkor etilmaydi).
    const consume = await consumeMagicLinkJti(
      result.jti,
      result.userId,
      new Date(result.expiresAtMs),
    );
    if (consume !== "consumed") return failRedirect();

    // Sanity: foydalanuvchi hali ham mavjud va faol bo'lsin (o'chirilgan bo'lishi mumkin).
    // Аудит ТЗ №7 #9 — tashiб qo'yamiz tokenVersion (session-token эпохи).
    const user = await db.user.findFirst({
      where: { id: result.userId, isActive: true },
      select: { id: true, tokenVersion: true },
    });
    if (!user) return failRedirect();

    const sessionToken = await signSessionToken(result.userId, user.tokenVersion);
    if (!sessionToken) return failRedirect(); // AUTH_COOKIE_SECRET yo'q — fail-closed.

    // Ленивая уборка истраченных/устаревших jti (2-мин TTL) — не блокирует
    // выдачу cookie, ошибка проглатывается внутри prune.
    void pruneExpiredMagicJti().catch(() => {});

    // `next=/path` — magic-link ochilgach yo'naltiriladigan ichki manzil.
    // XAVFSIZLIK: faqat bir `/` bilan boshlanuvchi (nisbiy) yo'l; `//host`,
    // `/\host`, sxemali URL (`http://…`) va bo'sh — RAD etiladi (open-redirect
    // himoyasi). Aks holda — bosh sahifa (`/`).
    const rawNext = url.searchParams.get("next") ?? "";
    const safeNext =
      rawNext.length > 1 &&
      rawNext.startsWith("/") &&
      !rawNext.startsWith("//") &&
      !rawNext.startsWith("/\\")
        ? rawNext
        : "/";
    const res = NextResponse.redirect(new URL(safeNext, origin));
    res.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: THIRTY_DAYS,
    });
    return res;
  } catch (err) {
    console.error("[login/tg] xato:", err);
    return failRedirect();
  }
}
