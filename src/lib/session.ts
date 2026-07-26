// R1 — Rol-tizimi: amaldagi foydalanuvchini aniqlash (server-only).
// permissions.ts SOF dvigatel bo'lsa, bu modul DB va cookie bilan ishlaydi —
// shuning uchun uni faqat server component / server action chaqiradi.
//
// ✅ R6 (login-gate): amaldagi foydalanuvchi FAQAT haqiqiy `onyx_session`
// cookie'sidan (imzolangan userId → DB) aniqlanadi. Eski `onyx_demo_role`
// DEMO-SHIM butunlay OLIB TASHLANDI — endi sessiyasiz foydalanuvchi yo'q
// (login-gate middleware sessiyasizni /login'ga yo'naltiradi).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

  // Аудит ТЗ №7 #9: verify возвращает { userId, tokenVersion } или error-reason.
  // legacy (v1) / expired / badsig / malformed — все ведут к null, middleware
  // отправит на /login (qайta-login talab qilinadi).
  const res = await verifySessionToken(sessionCookie);
  if (!res.ok) return null;

  const real = await db.user.findFirst({
    where: { id: res.userId, isActive: true },
    select: { id: true, name: true, role: true, tokenVersion: true },
  });
  if (!real) return null;
  // «Log out everywhere» / password change: DB tokenVersion oshirilgan bo'lsa —
  // cookie'даги eski version endi yaroqsiz.
  if (real.tokenVersion !== res.tokenVersion) return null;

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
    // Аудит ТЗ №7 #9 — verify: { userId, tokenVersion } yoki reason (см. getRealSessionUser).
    const res = await verifySessionToken(sessionCookie);
    if (res.ok) {
      const real = await db.user.findFirst({
        where: { id: res.userId, isActive: true },
        select: {
          id: true,
          name: true,
          role: true,
          canSeePurchasePrice: true,
          tokenVersion: true,
        },
      });
      if (real && real.tokenVersion === res.tokenVersion) {
        return {
          id: real.id,
          name: real.name,
          role: real.role as Role,
          canSeePurchasePrice: real.canSeePurchasePrice,
        };
      }
      // Token yaroqli, ammo user o'chirilgan/nofaol yoki tokenVersion oshirilgan →
      // kirish yo'q (revoked). Foydalanuvchi qайta login qiladi.
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

/**
 * Аудит ТЗ №7 #28 — boilerplate `if (!(await getCapabilities())[k]) redirect(...)`
 * повторялся в 7+ action'ах (kamen ×5, zayavki, lead-actions). Helper: если
 * capability false → next-redirect на deniedUrl. Action продолжает как обычно
 * при true. Return-based actions (useActionState с { errors: { form } }) — свой
 * шаблон, здесь не унифицируем: сообщение зависит от контекста и переводится
 * пользователю в UI формы.
 */
export async function requireCapabilityOrRedirect(
  key: keyof Capabilities,
  deniedRedirect: string,
): Promise<void> {
  if (!(await getCapabilities())[key]) redirect(deniedRedirect);
}

/**
 * Аудит ТЗ №7 #13 — единый OWNER-gate для action'ов (defense-in-depth, как
 * /accounts). Раньше существовали 2 разные копии в karta-sklada/actions.ts
 * (Promise<void>, redirect `&err=denied`) и accounts/actions.ts (Promise<string>
 * с возвратом id, redirect `?error=denied`). Дрифт между копиями = слабое звено
 * авторизации. Здесь — один helper, каждый вызывающий передаёт свой redirect-URL.
 * Возвращает id актёра (можно игнорировать, если не нужен).
 */
export async function requireOwner(deniedRedirect: string): Promise<string> {
  const me = await getRealSessionUser();
  if (!me || me.role !== "OWNER") redirect(deniedRedirect);
  return me.id;
}
