"use server";

// Login/logout server-action'lari (Part 1). Parol to'g'ri bo'lsa — imzolangan
// cookie o'rnatiladi va `next` ga qaytariladi (faqat ichki, same-site yo'l).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_NAME,
  SESSION_COOKIE,
  signSessionToken,
  signToken,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { verifyUserPassword } from "@/lib/password";
import { normalizeEmail } from "@/lib/accounts";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * Timing-oracle himoyasi: foydalanuvchi TOPILMAGANDA ham bitta PBKDF2 tekshiruvi
 * yuritiladi (bu doimiy hash ustida), shunda «login yo'q» yo'li «parol noto'g'ri»
 * yo'li bilan taxminan bir xil vaqt oladi — email mavjudligini vaqt orqali aniqlab
 * bo'lmaydi. Bu — real hisob EMAS, faqat throwaway satr xeshi (hech qachon mos
 * kelmaydi). Format: pbkdf2$100000$<saltB64>$<hashB64> (password.ts bilan bir xil).
 */
const DUMMY_PASSWORD_HASH =
  "pbkdf2$100000$jih/k+dr4aFCwtfkuR9zZg==$0+HV9lG7i0mmYKpsBnu1DeXOF8HkVMwKWyqhrfrO2pE=";

/**
 * `next`'ni faqat ichki (same-site) yo'lga cheklaydi: `/` bilan boshlanadi, lekin
 * ikkinchi belgi `/` yoki `\` emas — `//evil.com` va `/\evil.com` (brauzer `\`→`/`
 * normalizatsiyasi bilan protokol-nisbiy tashqi URL) open-redirect'ini yopadi.
 */
function sanitizeNext(raw: string): string {
  if (!raw.startsWith("/") || raw[1] === "/" || raw[1] === "\\") return "/";
  return raw;
}

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNext(String(formData.get("next") ?? "/"));

  if (!verifyPassword(password)) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const token = await signToken();
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: THIRTY_DAYS,
  });

  redirect(next);
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  redirect("/");
}

// ───────────────────────── OWN-03: haqiqiy login (email + parol) ─────────────────────────

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: THIRTY_DAYS,
};

/**
 * Email + parol bo'yicha haqiqiy login. Muvaffaqiyatda — imzolangan `onyx_session`
 * cookie'si (getCurrentUser demo-roldan ustun qo'yadi) va `next`ga qaytish.
 *
 * ⚠️ XAVFSIZLIK: xato DOIM generic (`error=login`) — qaysi biri (login/parol)
 * noto'g'ri ekani OSHKOR ETILMAYDI (user-enumeration'dan himoya). passwordHash
 * null bo'lgan (masalan, faqat Telegram) foydalanuvchi PAROL bilan kira olmaydi.
 */
export async function loginWithPassword(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNext(String(formData.get("next") ?? "/"));

  const fail = (): never =>
    redirect(`/login?error=login&next=${encodeURIComponent(next)}`);

  if (!email || !password) return fail();

  const user = await db.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, passwordHash: true },
  });
  // Foydalanuvchi yo'q → DUMMY xesh ustida bitta verify yuritamiz (timing-oracle
  // himoyasi), so'ng generic xato. Bu «parol noto'g'ri» yo'li bilan vaqtni tenglashtiradi.
  if (!user) {
    await verifyUserPassword(password, DUMMY_PASSWORD_HASH);
    return fail();
  }
  // passwordHash null → parol bilan kirish yo'q. verifyUserPassword ham null'da false.
  if (!(await verifyUserPassword(password, user.passwordHash))) {
    return fail();
  }

  const token = await signSessionToken(user.id);
  if (!token) return fail(); // AUTH_COOKIE_SECRET yo'q — fail-closed.

  const store = await cookies();
  store.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTS);
  redirect(next);
}

/** Haqiqiy sessiyadan chiqish — `onyx_session` cookie'sini tozalaydi. */
export async function logoutSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
