// R1 — Rol-tizimi: amaldagi foydalanuvchini aniqlash (server-only).
// permissions.ts SOF dvigatel bo'lsa, bu modul DB va cookie bilan ishlaydi —
// shuning uchun uni faqat server component / server action chaqiradi.
//
// ✅ R6 (login-gate): amaldagi foydalanuvchi FAQAT haqiqiy `onyx_session`
// cookie'sidan (imzolangan userId → DB) aniqlanadi. Eski `onyx_demo_role`
// DEMO-SHIM butunlay OLIB TASHLANDI — endi sessiyasiz foydalanuvchi yo'q
// (login-gate middleware sessiyasizni /login'ga yo'naltiradi).

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { capabilitiesFor, type Capabilities, type Role } from "@/lib/permissions";

export interface CurrentUser {
  id: string;
  name: string;
  role: Role;
  canSeePurchasePrice: boolean;
}

/** Faqat haqiqiy sessiya foydalanuvchisi (demo-shim'siz). */
export interface RealSessionUser {
  id: string;
  name: string;
  role: Role;
}

/**
 * ⚠️ XAVFSIZLIK GATE'i (OWN-03): FAQAT haqiqiy `onyx_session` cookie'sini o'qiydi,
 * imzosini `verifySessionToken` bilan tekshiradi va DB'dan faol foydalanuvchini
 * yuklaydi. `onyx_demo_role` cookie'siga HECH QACHON qaramaydi — shu tufayli
 * anonim tashrifchi `onyx_demo_role=OWNER` qo'yib akkaunt boshqaruviga o'ta olmaydi.
 *
 * Bu — getCurrentUser'ning session-tarmog'i, ammo demo fallback'ga TUSHMAYDIGAN
 * qilib ajratilgan. Faqat /accounts sahifasi + uning action'lari shuni ishlatadi;
 * saytning qolgan «kodsiz demo» xatti-harakati o'zgarishsiz qoladi.
 * Sessiya yo'q / imzo yaroqsiz / user nofaol yoki topilmadi → null.
 */
export async function getRealSessionUser(): Promise<RealSessionUser | null> {
  const store = await cookies();
  const sessionCookie = store.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) return null;

  const userId = await verifySessionToken(sessionCookie);
  if (!userId) return null;

  const real = await db.user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true, name: true, role: true },
  });
  if (!real) return null;

  return { id: real.id, name: real.name, role: real.role as Role };
}


/**
 * Amaldagi foydalanuvchi. Ustuvorlik (SK-4b):
 *   1) HAQIQIY LOGIN — `onyx_session` cookie'si (Telegram magic-link login orqali
 *      o'rnatiladi). Imzo yaroqli bo'lsa, tokendagi userId bo'yicha AYNAN o'sha
 *      faol foydalanuvchi yuklanadi. Bu — «o'zi sifatida» kirgan real sessiya.
 *   2) DEMO-SHIM — session yo'q/buzuq bo'lsa, eski `onyx_demo_role` xatti-harakati
 *      (rol cookie'si → shu roldagi eng eski faol User). Sayt «kodsiz» ochiq
 *      turgani uchun demo fallback saqlanadi va faqat yakuniy go-live'da OLIB
 *      TASHLANADI (o'shanda login yagona yo'l bo'ladi).
 * Foydalanuvchi topilmasa — null (mavjud stub'lar bilan bir xil kontrakt).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();

  // (1) Haqiqiy sessiya cookie'si ustuvor.
  const sessionCookie = store.get(SESSION_COOKIE)?.value;
  if (sessionCookie) {
    const userId = await verifySessionToken(sessionCookie);
    if (userId) {
      const real = await db.user.findFirst({
        where: { id: userId, isActive: true },
        select: { id: true, name: true, role: true, canSeePurchasePrice: true },
      });
      if (real) {
        return {
          id: real.id,
          name: real.name,
          role: real.role as Role,
          canSeePurchasePrice: real.canSeePurchasePrice,
        };
      }
      // Token yaroqli, ammo user o'chirilgan/nofaol → kirish yo'q.
    }
  }

  // R6: DEMO-fallback OLIB TASHLANDI. Haqiqiy sessiya bo'lmasa — foydalanuvchi
  // yo'q. Login-gate (middleware) sessiyasizni /login'ga yo'naltiradi; sahifalar
  // va action'lar ham getCapabilities → deny-all (PARTNER) default bilan
  // himoyalanadi.
  return null;
}

/**
 * БАГ-27: actor-id — action'lar yozuvni kimga bog'lash uchun ishlatadigan
 * amaldagi foydalanuvchi id'si (menejer, skladchik — R1: identity plumbing
 * only, rol tekshiruvi getCapabilities orqali alohida bo'ladi). Foydalanuvchi
 * topilmasa — null (mavjud stub'lar bilan bir xil kontrakt).
 */
export async function currentActorId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
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

/**
 * R2 — Bitta huquqni tekshirish. Sahifalar shu bilan `<NoAccess/>` ko'rsatishni
 * hal qiladi, action'lar esa yozuvdan oldin rad etadi. getCapabilities()
 * natijasidagi bitta bayroq — qulay qisqartma.
 */
export async function requireCapability(
  key: keyof Capabilities,
): Promise<boolean> {
  return (await getCapabilities())[key];
}
