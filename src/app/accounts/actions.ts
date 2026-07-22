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
import { getRealSessionUser } from "@/lib/session";
import { hashUserPassword } from "@/lib/password";
import {
  isCreatableRole,
  isToggleableRole,
  isValidPassword,
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
async function requireOwner(): Promise<string> {
  const me = await getRealSessionUser();
  if (!me || me.role !== "OWNER") redirect("/accounts?error=denied");
  return me.id;
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
  });
  if (!parsed.ok) redirect(`/accounts?error=${parsed.error}`);

  const { name, email, password, role } = parsed.value;
  const passwordHash = await hashUserPassword(password);

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name, role, email, passwordHash, isActive: true },
        select: { id: true },
      });
      await logAccountAction(tx, actorId, created.id, {
        kind: "account.create",
        name,
        email,
        role,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect("/accounts?error=email_taken");
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
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await logAccountAction(tx, actorId, userId, { kind: "account.reset_password" });
  });

  revalidatePath("/accounts");
  redirect("/accounts?ok=password");
}
