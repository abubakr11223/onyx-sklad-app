// R6 — Login-gate. Sessiyasiz so'rovlarni /login ga yo'naltiradi.
//
// YENGIL & EDGE-XAVFSIZ: faqat session-cookie IMZOSINI tekshiradi
// (verifySessionToken — Web Crypto, DB YO'Q, node:crypto YO'Q). Rol/huquq
// tekshiruvi bu yerda EMAS — sahifalar va server-action'lar o'zlari qayta
// tekshiradi (defense-in-depth). Gate faqat «kirganmi/kirmaganmi»ni hal qiladi.
//
// matcher: /login, /login/tg, /q (§6.7 QR ochiq shou-room — mijoz login qilmagan)
// va barcha /api, statik fayllar gate'DAN TASHQARIDA (/api'da o'z auth'i bor —
// Telegram webhook secret, cron secret).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySessionToken(token) : null;
  if (userId) return NextResponse.next();

  // Sessiya yo'q → /login. Kelingan yo'lni ?next bilan saqlaymiz (login'dan keyin
  // qaytish uchun). Open-redirect xavfi yo'q — bu faqat lokal path.
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const target = req.nextUrl.pathname + req.nextUrl.search;
  if (target && target !== "/login") {
    loginUrl.searchParams.set("next", target);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|api|q/|tg|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
