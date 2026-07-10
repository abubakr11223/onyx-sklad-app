// R1 — Rol-tizimi: amaldagi foydalanuvchini aniqlash (server-only).
// permissions.ts SOF dvigatel bo'lsa, bu modul DB va cookie bilan ishlaydi —
// shuning uchun uni faqat server component / server action chaqiradi.
//
// ⚠️ DEMO-SHIM (R1): amaldagi rol `onyx_demo_role` cookie'sidan olinadi va
// shu roldagi BIRINCHI faol foydalanuvchi seed'dan yuklanadi. Bu sayt «kodsiz»
// ochiq turganda har bir rolni demo qilish uchun. R6'da bu butunlay
// almashtiriladi: haqiqiy login cookie'sidan imzolangan userId o'qiladi va
// `onyx_demo_role` cookie'si go-live'da OLIB TASHLANADI.

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { capabilitiesFor, type Capabilities, type Role } from "@/lib/permissions";

/** DEMO cookie nomi — R6'da olib tashlanadi (demo-role.ts ham shuni yozadi). */
export const DEMO_ROLE_COOKIE = "onyx_demo_role";

/** Cookie yo'q/buzuq bo'lsa — MANAGER (mavjud oqimlar aynan shu holatda ishlaydi). */
const DEFAULT_DEMO_ROLE: Role = "MANAGER";

const VALID_ROLES: readonly Role[] = ["OWNER", "MANAGER", "WAREHOUSE", "PARTNER"];

export interface CurrentUser {
  id: string;
  name: string;
  role: Role;
  canSeePurchasePrice: boolean;
}

/** String'ni Role union'iga xavfsiz keltirish; noto'g'ri → default MANAGER. */
function parseDemoRole(raw: string | undefined): Role {
  return VALID_ROLES.includes(raw as Role) ? (raw as Role) : DEFAULT_DEMO_ROLE;
}

/**
 * Amaldagi foydalanuvchi (DEMO-shim). `onyx_demo_role` cookie'sini o'qiydi
 * (yo'q/buzuq → MANAGER) va shu roldagi eng eski faol User'ni yuklaydi.
 * Bunday foydalanuvchi bo'lmasa — null (chaqiruvchi «seed kerak» xatosini beradi,
 * mavjud stub'lar bilan bir xil kontrakt).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const role = parseDemoRole(store.get(DEMO_ROLE_COOKIE)?.value);

  const user = await db.user.findFirst({
    where: { role, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, role: true, canSeePurchasePrice: true },
  });
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    role: user.role as Role,
    canSeePurchasePrice: user.canSeePurchasePrice,
  };
}

/**
 * Amaldagi foydalanuvchi huquqlari. Foydalanuvchi topilmasa — eng cheklangan
 * XAVFSIZ default (PARTNER: hech qanday narx/sotuv/ombor huquqi yo'q) —
 * shunda «foydalanuvchi yo'q» holati hech qachon ortiqcha ruxsat bermaydi.
 */
export async function getCapabilities(): Promise<Capabilities> {
  const user = await getCurrentUser();
  if (!user) return capabilitiesFor("PARTNER", { canSeePurchasePrice: false });
  return capabilitiesFor(user.role, {
    canSeePurchasePrice: user.canSeePurchasePrice,
  });
}
