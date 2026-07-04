"use server";

// Login/logout server-action'lari (Part 1). Parol to'g'ri bo'lsa — imzolangan
// cookie o'rnatiladi va `next` ga qaytariladi (faqat ichki, same-site yo'l).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, signToken, verifyPassword } from "@/lib/auth";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

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
