// Parol darvozasi (Part 1). Himoyalangan sahifalarga cookie'siz kirishni
// /login ga yo'naltiradi. Yengil: faqat cookie imzosini tekshiradi (verifyToken).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

// Har doim himoyalanadigan bo'lim prefikslari.
const PROTECTED_PREFIXES = [
  "/priemka",
  "/prodazha",
  "/bron",
  "/razbit",
  "/poisk",
];

function needsAuth(pathname: string, search: string): boolean {
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  // /karta — faqat ?edit bo'lganda (tahrirlash rejimi) himoyalanadi.
  if (pathname === "/karta") {
    return new URLSearchParams(search).has("edit");
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!needsAuth(pathname, search)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token && (await verifyToken(token))) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // _next, statik fayllar, favicon va API'ni chetlab o'tamiz.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
