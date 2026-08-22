// ⚠️ VAQTINCHALIK: parol darvozasi O'CHIRILGAN (user ko'rsatmasi 2026-07-09
// «saytni kodsiz qilaylik» — demo/CEO ko'rsatuvi uchun). Hozir barcha sahifalar
// (/priemka /prodazha /bron /razbit /poisk /fotozapros, karta ?edit) PAROLSIZ ochiq.
//
// 🔒 REAL OMBOR MA'LUMOTI/NARXLAR KIRITILISHIDAN OLDIN QAYTA YOQISH SHART.
// Asl parol darvozasi git tarixida: commit `d93a308` (src/middleware.ts) —
// undan tiklab, PROTECTED_PREFIXES + /login redirect mantig'ini qaytaring.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_req: NextRequest) {
  // Hech nima gate qilinmaydi — barcha so'rovlar o'tadi.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
