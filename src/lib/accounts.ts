// OWN-03 — Akkaunt boshqaruvi: SOF validatsiya (DB YO'Q, next YO'Q).
// permissions.ts / nav-access.ts uslubida — alohida unit-testlanadi.
// Server-action'lar (accounts/actions.ts) shu funksiyalarni chaqiradi va
// qo'shimcha ravishda canManageAccounts'ni SERVERDA qayta tekshiradi.

import type { Role } from "@/lib/permissions";

/**
 * Bu forma orqali YARATILISHI/O'ZGARTIRILISHI mumkin bo'lgan rollar.
 * OWNER — root/seed akkaunti (bu yerdan yaratilmaydi). PARTNER — alohida oqim
 * (Telegram), akkaunt-forma undan foydalanmaydi. Faqat MANAGER / WAREHOUSE.
 */
export const CREATABLE_ROLES = ["MANAGER", "WAREHOUSE"] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

/** Parolning minimal uzunligi (OWN-03 xavfsizlik talabi). */
export const MIN_PASSWORD_LENGTH = 8;

/** Rol shu forma orqali yaratsa/o'zgartirsa bo'ladimi (OWNER/PARTNER — yo'q). */
export function isCreatableRole(role: string): role is CreatableRole {
  return (CREATABLE_ROLES as readonly string[]).includes(role);
}

/** Email'ni normallashtirish: trim + lowercase (unique solishtiruvi barqaror bo'lsin). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Juda oddiy email tekshiruvi (bo'sh emas, bitta @, atrofida belgilar bor). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Parol yetarli uzunlikdami. */
export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export interface NewAccountInput {
  name: string;
  email: string;
  password: string;
  role: string;
}

export interface ValidNewAccount {
  name: string;
  email: string;
  password: string;
  role: CreatableRole;
}

/** Qaysi maydon xato ekanini bildiruvchi kod (UI generic-ish xabar ko'rsatadi). */
export type AccountFieldError = "name" | "email" | "password" | "role";

/**
 * Yangi akkaunt kiritmasini tekshiradi va normallashtiradi. Muvaffaqiyatda —
 * tozalangan qiymatlar; aks holda — birinchi xato maydon kodi.
 * Tartib: name → role → email → password (barqaror, testlanadigan).
 */
export function validateNewAccount(
  input: NewAccountInput,
): { ok: true; value: ValidNewAccount } | { ok: false; error: AccountFieldError } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name" };

  // Rol allowlist: OWNER/PARTNER va noma'lum qiymatlar rad etiladi (xavfsizlik).
  if (!isCreatableRole(input.role)) return { ok: false, error: "role" };

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: "email" };

  const password = input.password;
  if (!isValidPassword(password)) return { ok: false, error: "password" };

  return { ok: true, value: { name, email, password, role: input.role } };
}

/** Rolni RU display uchun (roleLabel bilan bir xil, ammo bu yerda type-only). */
export type { Role };
