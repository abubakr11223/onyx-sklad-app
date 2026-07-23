// OWN-03 — Akkaunt boshqaruvi: SOF validatsiya (DB YO'Q, next YO'Q).
// permissions.ts / nav-access.ts uslubida — alohida unit-testlanadi.
// Server-action'lar (accounts/actions.ts) shu funksiyalarni chaqiradi va
// qo'shimcha ravishda canManageAccounts'ni SERVERDA qayta tekshiradi.

import type { Role } from "@/lib/permissions";

/**
 * Bu forma orqali YARATILISHI/O'ZGARTIRILISHI mumkin bo'lgan rollar.
 * OWNER — root/seed akkaunti (bu yerdan yaratilmaydi — ruxsat oshirish xavfi).
 * A1 (TZ §6.8): PARTNER (дизайнер-партнёр) endi shu forma orqali yaratiladi —
 * egasi partnyorga login/parol beradi. PARTNER — eng kam huquqli rol, shuning
 * uchun uni yaratish xavfsiz. MANAGER / WAREHOUSE — avvalgidek.
 */
export const CREATABLE_ROLES = ["MANAGER", "WAREHOUSE", "PARTNER"] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

/** Parolning minimal uzunligi (OWN-03 xavfsizlik talabi). */
export const MIN_PASSWORD_LENGTH = 8;

/** Rol shu forma orqali yaratsa bo'ladimi (OWNER — yo'q). */
export function isCreatableRole(role: string): role is CreatableRole {
  return (CREATABLE_ROLES as readonly string[]).includes(role);
}

/**
 * Rolni bu forma orqali BOSHQA rolga almashtirish mumkin bo'lganlar — FAQAT
 * MANAGER ↔ WAREHOUSE. PARTNER yaratiladi (CREATABLE), lekin ko'tarilmaydi:
 * partnyorni menejerga ko'tarish = ruxsat oshirish xavfi (taqiqlanadi). OWNER —
 * hech qachon. Bu to'plam createAccount uchun emas, faqat changeRole gate'i uchun
 * (UI'dagi isRoleToggleable bilan bir xil shartnoma).
 */
export const TOGGLEABLE_ROLES = ["MANAGER", "WAREHOUSE"] as const;
export type ToggleableRole = (typeof TOGGLEABLE_ROLES)[number];
export function isToggleableRole(role: string): role is ToggleableRole {
  return (TOGGLEABLE_ROLES as readonly string[]).includes(role);
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

// ── Telefon (skladchi Telegram bog'lanishi uchun) ───────────────────────────
// ⚠️ MUHIM: normalizePhone telegram-webhook.ts'dagi bilan BIR XIL mantiqда
// bo'lishi shart — handleContact skladchi ulashgan raqamni aynan shu shaklда
// (faqat raqamlar) solishtiradi. Aks holda panelдан kiritilgan telefon Telegram
// raqami bilan mos kelmaydi va bog'lanish ishlamaydi.
export function normalizePhone(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\D+/g, "");
}

/** Telefon maqbulmi: 9–15 ta raqam (xalqaro diapazon; UZ = 12: 998 + 9). */
export function isValidPhone(s: string): boolean {
  const d = normalizePhone(s);
  return d.length >= 9 && d.length <= 15;
}

/** Saqlash uchun kanonik shakl: `+<raqamlar>` (unique barqaror bo'lsin). */
export function canonicalPhone(s: string): string {
  const d = normalizePhone(s);
  return d ? "+" + d : "";
}

export interface NewAccountInput {
  name: string;
  email: string;
  password: string;
  role: string;
  /** Telefon ixtiyoriy (skladchi uchun kerak — Telegram bog'lanishi). */
  phone?: string;
}

export interface ValidNewAccount {
  name: string;
  email: string;
  password: string;
  role: CreatableRole;
  /** Kanonik `+<raqamlar>` yoki null (berilmagan bo'lsa). */
  phone: string | null;
}

/** Qaysi maydon xato ekanini bildiruvchi kod (UI generic-ish xabar ko'rsatadi). */
export type AccountFieldError = "name" | "email" | "password" | "role" | "phone";

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

  // Rol allowlist: OWNER va noma'lum qiymatlar rad etiladi (xavfsizlik).
  if (!isCreatableRole(input.role)) return { ok: false, error: "role" };

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: "email" };

  const password = input.password;
  if (!isValidPassword(password)) return { ok: false, error: "password" };

  // Telefon ixtiyoriy: berilsa — maqbul bo'lishi va kanonik shaklда saqlanishi.
  const rawPhone = (input.phone ?? "").trim();
  let phone: string | null = null;
  if (rawPhone) {
    if (!isValidPhone(rawPhone)) return { ok: false, error: "phone" };
    phone = canonicalPhone(rawPhone);
  }

  return { ok: true, value: { name, email, password, role: input.role, phone } };
}

/** Rolni RU display uchun (roleLabel bilan bir xil, ammo bu yerda type-only). */
export type { Role };
