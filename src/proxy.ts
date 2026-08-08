// R6 — Login-gate (Next.js 16: proxy convention; was middleware.ts).
// Sessiyasiz so'rovlarni /login ga yo'naltiradi.
//
// YENGIL & EDGE-XAVFSIZ: faqat session-cookie IMZOSINI tekshiradi
// (verifySessionToken — Web Crypto, DB YO'Q, node:crypto YO'Q). Rol/huquq
// tekshiruvi bu yerda EMAS — sahifalar va server-action'lar o'zlari qayta
// tekshiradi (defense-in-depth). Gate faqat «kirganmi/kirmaganmi»ni hal qiladi.
//
// BUG-OWN trust: proxy runs on public paths too (login/api/q/tg) so it can
// STRIP a client-forged x-onyx-gated header before RootLayout. Only gated
// routes with a valid session signature SET the stamp.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import {
  GATED_REQUEST_HEADER,
  isProxyPublicPath,
  stripClientGatedHeader,
} from "@/lib/gated-request";

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  // Always start from request headers and drop any client-supplied stamp.
  const headers = new Headers(req.headers);
  stripClientGatedHeader(headers);

  // Public entry: strip only, never gate, never re-stamp.
  if (isProxyPublicPath(pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // Аудит ТЗ №7 #9 — verify: signature+expiry only on Edge.
  // tokenVersion / isActive / existence — session.ts (Node + DB).
  const res = token ? await verifySessionToken(token) : null;
  if (res?.ok) {
    // Signature OK — stamp path for layout stale-session re-login.
    // Overwrites any residual value (already deleted above).
    headers.set(
      GATED_REQUEST_HEADER,
      req.nextUrl.pathname + req.nextUrl.search,
    );
    return NextResponse.next({ request: { headers } });
  }

  // No/invalid session → /login. Keep ?next for return path (local only).
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
    // Run on app pages AND public paths (login/api/q/tg) so the header strip
    // always happens. Still skip static assets and files with extensions.
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
