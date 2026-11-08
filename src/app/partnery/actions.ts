"use server";

// ТЗ №20 L (§13.1) — «Партнёры»: завести партнёра (логин/пароль), тип
// (дизайнер / прораб / подрядчик), закреплённый менеджер, отключить/включить,
// новый пароль. Делают владелец и менеджер (canManagePartners) — по РЕАЛЬНОЙ
// сессии. Действия трогают ТОЛЬКО аккаунты роли PARTNER: сотрудника через эту
// страницу не изменить. Каждое действие — в «Историю» (STATUS_CHANGE / User).

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getRealSessionUser } from "@/lib/session";
import { capabilitiesFor } from "@/lib/permissions";
import { hashUserPassword } from "@/lib/password";
import { isValidPassword, validateNewAccount } from "@/lib/accounts";
import { isPartnerType } from "@/lib/partners";

const BACK = "/partnery";

function fail(code: string): never {
  redirect(`${BACK}?error=${code}`);
}

async function requirePartnerManager(): Promise<string> {
  const me = await getRealSessionUser();
  if (!me || !capabilitiesFor(me.role, { canSeePurchasePrice: false }).canManagePartners) {
    fail("denied");
  }
  return me.id;
}

/** Закреплённый менеджер: пусто → null; иначе активный OWNER/MANAGER. */
async function parseManager(raw: FormDataEntryValue | null): Promise<string | null> {
  const id = String(raw ?? "").trim();
  if (!id) return null;
  const m = await db.user.findFirst({
    where: { id, isActive: true, role: { in: ["OWNER", "MANAGER"] } },
    select: { id: true },
  });
  if (!m) fail("manager");
  return m.id;
}

async function audit(
  tx: Prisma.TransactionClient,
  actorId: string,
  targetId: string,
  payload: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: "STATUS_CHANGE",
      entityType: "User",
      entityId: targetId,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

/** Только партнёр (не сотрудник, не владелец). */
async function partnerOrFail(id: string): Promise<{ id: string; isActive: boolean }> {
  const p = await db.user.findFirst({
    where: { id, role: "PARTNER" },
    select: { id: true, isActive: true },
  });
  if (!p) fail("notfound");
  return p;
}

export async function createPartner(formData: FormData): Promise<void> {
  const actorId = await requirePartnerManager();
  const parsed = validateNewAccount({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    role: "PARTNER",
    phone: String(formData.get("phone") ?? ""),
  });
  if (!parsed.ok) fail(parsed.error);
  const type = String(formData.get("partnerType") ?? "");
  if (!isPartnerType(type)) fail("type");
  const managerId = await parseManager(formData.get("managerId"));

  const { name, email, password, phone } = parsed.value;
  const passwordHash = await hashUserPassword(password);
  try {
    await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          role: "PARTNER",
          email,
          passwordHash,
          phone,
          isActive: true,
          partnerType: type,
          partnerManagerId: managerId,
        },
        select: { id: true },
      });
      await audit(tx, actorId, created.id, {
        kind: "partner.create",
        name,
        email,
        phone,
        partnerType: type,
        partnerManagerId: managerId,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = e.meta?.target;
      const hitPhone = Array.isArray(target)
        ? target.includes("phone")
        : String(target ?? "").includes("phone");
      fail(hitPhone ? "phone_taken" : "email_taken");
    }
    throw e;
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ok=created`);
}

export async function updatePartner(formData: FormData): Promise<void> {
  const actorId = await requirePartnerManager();
  const p = await partnerOrFail(String(formData.get("id") ?? ""));
  const type = String(formData.get("partnerType") ?? "");
  if (!isPartnerType(type)) fail("type");
  const managerId = await parseManager(formData.get("managerId"));
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: p.id },
      data: { partnerType: type, partnerManagerId: managerId },
    });
    await audit(tx, actorId, p.id, {
      kind: "partner.update",
      partnerType: type,
      partnerManagerId: managerId,
    });
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=updated#p-${p.id}`);
}

export async function setPartnerActive(formData: FormData): Promise<void> {
  const actorId = await requirePartnerManager();
  const p = await partnerOrFail(String(formData.get("id") ?? ""));
  const active = String(formData.get("active") ?? "") === "1";
  if (p.isActive !== active) {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: p.id },
        // Отключение сразу выкидывает из сайта (как в «Сотрудниках»).
        data: active ? { isActive: true } : { isActive: false, tokenVersion: { increment: 1 } },
      });
      await audit(tx, actorId, p.id, { kind: active ? "partner.activate" : "partner.deactivate" });
    });
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${active ? "activated" : "deactivated"}#p-${p.id}`);
}

export async function resetPartnerPassword(formData: FormData): Promise<void> {
  const actorId = await requirePartnerManager();
  const p = await partnerOrFail(String(formData.get("id") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (!isValidPassword(password)) fail("password");
  const passwordHash = await hashUserPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: p.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await audit(tx, actorId, p.id, { kind: "partner.password" });
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=password#p-${p.id}`);
}
