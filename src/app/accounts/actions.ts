"use server";

// OWN-03 — Akkaunt boshqaruvi server-action'lari (FAQAT OWNER).
// Har bir action canManageAccounts'ni SERVERDA qayta tekshiradi (defense-in-depth:
// nav/sahifa gate'iga ISHONMAYMIZ). Yozuv + AuditLog bitta tranzaksiyada.
//
// ⚠️ XAVFSIZLIK:
//  • createAccount FAQAT MANAGER/WAREHOUSE yaratadi — OWNER/PARTNER emas.
//  • O'chirish — SOFT (isActive=false), hard-delete YO'Q (tarix/audit havolalari).
//  • OWNER'ni bu UI orqali o'chirib/rolini o'zgartirib bo'lmaydi (root himoyasi).
//  • O'zini o'zi o'chirib bo'lmaydi (self-lockout himoyasi).
//  • Parol hech qachon ochiq saqlanmaydi/loglanmaydi — faqat PBKDF2 xesh.
//
// AuditLog: yangi enum a'zosi qo'shmaslik uchun (migratsiya YO'Q) — mavjud
// `STATUS_CHANGE` action + entityType "User" + payload.kind bilan yoziladi.

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getRealSessionUser, requireOwner as requireOwnerBase } from "@/lib/session";
import { hashUserPassword } from "@/lib/password";
import { sendMessage } from "@/lib/telegram";
import { roleLabel } from "@/lib/role-labels";
import type { Role } from "@/lib/permissions";
import {
  canonicalPhone,
  isCreatableRole,
  isToggleableRole,
  isValidEmail,
  isValidPassword,
  isValidPhone,
  normalizeEmail,
  validateNewAccount,
} from "@/lib/accounts";

/**
 * OWNER gate + amaldagi foydalanuvchi id'si.
 *
 * ⚠️ XAVFSIZLIK: FAQAT haqiqiy sessiya (getRealSessionUser) — demo-shim EMAS.
 * Ilgari bu `canManageAccounts` capability'siga tayangan, u esa session yo'qligida
 * `onyx_demo_role` cookie'sidan kelib chiqardi; anonim tashrifchi cookie'ni OWNER
 * qilib qo'yib akkauntlarni egallab olishi mumkin edi. Endi har action DB'dagi
 * haqiqiy rolni qayta talab qiladi. Sessiya yo'q / rol ≠ OWNER → yozuvdan OLDIN rad.
 */
// Аудит ТЗ №7 #13 — общий OWNER-gate из lib/session.ts (был локальный дубль,
// расходившийся с karta-sklada по redirect-URL и return type).
async function requireOwner(): Promise<string> {
  return requireOwnerBase("/accounts?error=denied");
}

/** AuditLog yozuvi (STATUS_CHANGE + entityType "User" + payload.kind). */
async function logAccountAction(
  tx: Prisma.TransactionClient,
  actorId: string,
  targetId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: actorId || null,
      action: "STATUS_CHANGE",
      entityType: "User",
      entityId: targetId,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

/**
 * Yangi akkaunt (MANAGER/WAREHOUSE). Validatsiya → hash → user.create + audit.
 * Email band bo'lsa (P2002) → «логин занят». Rol OWNER/PARTNER bo'lsa validator
 * rad etadi (isCreatableRole).
 */
export async function createAccount(formData: FormData): Promise<void> {
  const actorId = await requireOwner();

  const parsed = validateNewAccount({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    role: String(formData.get("role") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
  if (!parsed.ok) redirect(`/accounts?error=${parsed.error}`);

  const { name, email, password, role, phone } = parsed.value;
  const passwordHash = await hashUserPassword(password);

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name, role, email, passwordHash, isActive: true, phone },
        select: { id: true },
      });
      await logAccountAction(tx, actorId, created.id, {
        kind: "account.create",
        name,
        email,
        role,
        phone,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // email va phone — ikkalasi ham @unique; qaysi biri to'qnashganini ajratamiz.
      const target = e.meta?.target;
      const hitPhone = Array.isArray(target)
        ? target.includes("phone")
        : String(target ?? "").includes("phone");
      redirect(`/accounts?error=${hitPhone ? "phone_taken" : "email_taken"}`);
    }
    throw e;
  }

  revalidatePath("/accounts");
  redirect("/accounts?ok=created");
}

/**
 * Akkauntni o'chirish — SOFT (isActive=false). Idempotent (allaqachon nofaol →
 * ok). OWNER va o'zini o'chirib bo'lmaydi.
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  const actorId = await requireOwner();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) redirect("/accounts?error=notfound");

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  });
  if (!target) redirect("/accounts?error=notfound");
  if (target.role === "OWNER") redirect("/accounts?error=owner_protected");
  if (target.id === actorId) redirect("/accounts?error=self");
  if (!target.isActive) redirect("/accounts?ok=deleted"); // idempotent

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: false } });
    await logAccountAction(tx, actorId, userId, { kind: "account.deactivate" });
  });

  revalidatePath("/accounts");
  redirect("/accounts?ok=deleted");
}

/**
 * Rolni almashtirish (faqat MANAGER ↔ WAREHOUSE). OWNER/PARTNER'ga tegilmaydi:
 * nishon roli ham, yangi rol ham creatable bo'lishi shart.
 */
export async function changeRole(formData: FormData): Promise<void> {
  const actorId = await requireOwner();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId) redirect("/accounts?error=notfound");
  // N2: faqat MANAGER↔WAREHOUSE. PARTNER endi CREATABLE (A1), lekin uni bu yerda
  // ko'tarib/tushirib bo'lmasligi kerak (partnyor→menejer = ruxsat oshirish).
  if (!isToggleableRole(role)) redirect("/accounts?error=role");

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) redirect("/accounts?error=notfound");
  // OWNER/PARTNER'ni bu UI orqali o'zgartirib bo'lmaydi.
  if (!isToggleableRole(target.role)) redirect("/accounts?error=owner_protected");
  if (target.role === role) redirect("/accounts?ok=role"); // no-op

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role } });
    await logAccountAction(tx, actorId, userId, {
      kind: "account.role",
      from: target.role,
      to: role,
    });
  });

  revalidatePath("/accounts");
  redirect("/accounts?ok=role");
}

/**
 * Parolni tiklash (yangi parol). Nishon — creatable rol YOKI o'z-o'zi (OWNER
 * o'z parolini almashtira oladi: seed default'dan keyin). Boshqa OWNER'ga yo'q.
 */
export async function resetPassword(formData: FormData): Promise<void> {
  const actorId = await requireOwner();
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId) redirect("/accounts?error=notfound");
  if (!isValidPassword(password)) redirect("/accounts?error=password");

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) redirect("/accounts?error=notfound");
  // Boshqa OWNER'ning parolini tiklab bo'lmaydi; o'ziniki mumkin.
  if (target.role === "OWNER" && target.id !== actorId) {
    redirect("/accounts?error=owner_protected");
  }

  const passwordHash = await hashUserPassword(password);
  await db.$transaction(async (tx) => {
    // Аудит ТЗ №7 #9 — смена пароля инкрементит tokenVersion → все ранее выпущенные
    // session-токены пользователя становятся невалидными («log out everywhere»).
    // getRealSessionUser/getCurrentUser сверяют cookie.tokenVersion с DB.
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await logAccountAction(tx, actorId, userId, { kind: "account.reset_password" });
  });

  revalidatePath("/accounts");
  redirect("/accounts?ok=password");
}

/**
 * Login (email) o'zgartirish. Nishon — creatable rol YOKI o'z-o'zi (OWNER o'z
 * gmailини almashtira oladi — topshirishдан keyin dasturchisiz). Boshqa OWNER'ga
 * yo'q. Email band bo'lsa (P2002) → «логин занят». Normallashtirilib (trim+lower)
 * saqlanadi — loginWithPassword ham normalizeEmail bilan solishtiradi (mos).
 */
export async function changeEmail(formData: FormData): Promise<void> {
  const actorId = await requireOwner();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) redirect("/accounts?error=notfound");

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!isValidEmail(email)) redirect("/accounts?error=email");

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true },
  });
  if (!target) redirect("/accounts?error=notfound");
  // Boshqa OWNER'ning loginini o'zgartirib bo'lmaydi; o'ziniki mumkin.
  if (target.role === "OWNER" && target.id !== actorId) {
    redirect("/accounts?error=owner_protected");
  }
  if (target.email === email) redirect("/accounts?ok=email"); // no-op

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { email } });
      await logAccountAction(tx, actorId, userId, { kind: "account.email", email });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect("/accounts?error=email_taken");
    }
    throw e;
  }

  revalidatePath("/accounts");
  redirect("/accounts?ok=email");
}

/**
 * Telefon o'rnatish/o'zgartirish (skladchi Telegram bog'lanishi uchun). Bo'sh
 * yuborilsa — telefon TOZALANADI (null). Boshqa OWNER'niki emas. Kanonik
 * `+<raqamlar>` shaklда saqlanadi (handleContact normalizePhone bilan mos).
 */
export async function changePhone(formData: FormData): Promise<void> {
  const actorId = await requireOwner();
  const userId = String(formData.get("userId") ?? "");
  const rawPhone = String(formData.get("phone") ?? "").trim();
  if (!userId) redirect("/accounts?error=notfound");

  let phone: string | null = null;
  if (rawPhone) {
    if (!isValidPhone(rawPhone)) redirect("/accounts?error=phone");
    phone = canonicalPhone(rawPhone);
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) redirect("/accounts?error=notfound");
  if (target.role === "OWNER" && target.id !== actorId) {
    redirect("/accounts?error=owner_protected");
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { phone } });
      await logAccountAction(tx, actorId, userId, { kind: "account.phone", phone });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect("/accounts?error=phone_taken");
    }
    throw e;
  }

  revalidatePath("/accounts");
  redirect("/accounts?ok=phone");
}

/**
 * Onboarding — ОДОБРИТЬ заявку на доступ через Telegram. FAQAT OWNER. Владелец
 * выбирает роль (createable; по умолчанию WAREHOUSE) → создаётся User с
 * telegramId+phone из заявки, isActive. Заявка → APPROVED. Пользователю уходит
 * Telegram-уведомление «доступ открыт» (best-effort — сбой TG не ломает одобрение).
 * Доступ НИКОГДА не выдаётся автоматически — только этим действием владельца.
 */
export async function approveTelegramRequest(formData: FormData): Promise<void> {
  const actorId = await requireOwner();
  const requestId = String(formData.get("requestId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  if (!requestId) redirect("/accounts?error=notfound");
  if (!name) redirect("/accounts?error=name");
  if (!isCreatableRole(role)) redirect("/accounts?error=role");

  const req = await db.telegramAccessRequest.findUnique({
    where: { id: requestId },
    select: { id: true, telegramId: true, phone: true, status: true },
  });
  if (!req) redirect("/accounts?error=notfound");
  if (req.status !== "PENDING") redirect("/accounts?ok=tg_approved"); // idempotent

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          role,
          telegramId: req.telegramId,
          phone: req.phone,
          isActive: true,
        },
        select: { id: true },
      });
      await tx.telegramAccessRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED" },
      });
      await logAccountAction(tx, actorId, created.id, {
        kind: "tg.approve",
        name,
        role,
        telegramId: req.telegramId,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = e.meta?.target;
      const hitPhone = Array.isArray(target)
        ? target.includes("phone")
        : String(target ?? "").includes("phone");
      redirect(`/accounts?error=${hitPhone ? "phone_taken" : "tg_taken"}`);
    }
    throw e;
  }

  // Уведомляем пользователя (best-effort): доступ открыт.
  try {
    await sendMessage(
      req.telegramId,
      `✅ Доступ открыт! Ваша роль: ${roleLabel(role as Role)}. Теперь задачи и фотозапросы будут приходить сюда.`,
    );
  } catch (err) {
    console.error("[accounts] tg approve notify xatosi:", err);
  }

  revalidatePath("/accounts");
  redirect("/accounts?ok=tg_approved");
}

/**
 * Onboarding — ОТКЛОНИТЬ заявку на доступ. FAQAT OWNER. Заявка → REJECTED,
 * аккаунт НЕ создаётся. Пользователю — вежливое уведомление (best-effort).
 */
export async function rejectTelegramRequest(formData: FormData): Promise<void> {
  const actorId = await requireOwner();
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) redirect("/accounts?error=notfound");

  const req = await db.telegramAccessRequest.findUnique({
    where: { id: requestId },
    select: { id: true, telegramId: true, status: true },
  });
  if (!req) redirect("/accounts?error=notfound");

  await db.$transaction(async (tx) => {
    await tx.telegramAccessRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED" },
    });
    await logAccountAction(tx, actorId, req.id, {
      kind: "tg.reject",
      telegramId: req.telegramId,
    });
  });

  try {
    await sendMessage(
      req.telegramId,
      "Заявка на доступ отклонена. Если это ошибка — обратитесь к вашему менеджеру.",
    );
  } catch (err) {
    console.error("[accounts] tg reject notify xatosi:", err);
  }

  revalidatePath("/accounts");
  redirect("/accounts?ok=tg_rejected");
}
