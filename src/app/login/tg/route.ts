// SK-4b — Telegram magic-link login qabul qiluvchi (GET).
// Foydalanuvchi Telegram'da kelgan `/login/tg?token=…` havolasini ochadi.
// Token yaroqli va muddati o'tmagan bo'lsa — imzolangan `onyx_session` cookie'si
// o'rnatiladi va `/` ga yo'naltiriladi. Aks holda — `/login?error=magic`.
// HECH QACHON foydalanuvchiga throw qilmaydi; xato sababi OSHKOR ETILMAYDI.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signSessionToken, verifyMagicLinkToken } from "@/lib/auth";
import { db } from "@/lib/db";

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
      // Sabab (malformed/badsig/expired) oshkor etilmaydi — yagona xato branch'i.
      return failRedirect();
    }

    // Sanity: foydalanuvchi hali ham mavjud va faol bo'lsin (o'chirilgan bo'lishi mumkin).
    // Аудит ТЗ №7 #9 — tashiб qo'yamiz tokenVersion (session-token эпохи).
    const user = await db.user.findFirst({
      where: { id: result.userId, isActive: true },
      select: { id: true, tokenVersion: true },
    });
    if (!user) return failRedirect();

    const sessionToken = await signSessionToken(result.userId, user.tokenVersion);
    if (!sessionToken) return failRedirect(); // AUTH_COOKIE_SECRET yo'q — fail-closed.

    // Login cookie flaglari login/actions.ts bilan bir xil.
    const res = NextResponse.redirect(new URL("/", origin));
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
