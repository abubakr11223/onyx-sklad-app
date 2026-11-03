"use server";

// TZ №9 Part B — repay debt (full only). Domain: src/lib/debts.ts (o1).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { repayDebt } from "@/lib/debts";
import {
  addDebtPayment,
  applyClientPayment,
  isPayMethod,
  PaymentError,
  toCents,
} from "@/lib/payments";
import { parseTashkentDayStart } from "@/lib/sale-history";
import { todayTashkentISO } from "@/lib/datetime";

function safeReturnTo(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/dolzhniki") || s.startsWith("//")) return "/dolzhniki";
  return s;
}

/**
 * Full repayment. Defense-in-depth: canSeeDebts (OWNER only).
 */
export async function repayDebtAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSeeDebts) {
    redirect("/dolzhniki?err=denied");
  }

  const actorId = await currentActorId();
  if (!actorId) {
    redirect("/dolzhniki?err=denied");
  }

  const debtId = String(formData.get("debtId") ?? "").trim();
  if (!debtId) {
    redirect("/dolzhniki?err=notfound");
  }

  const dateRaw = String(formData.get("repaidAt") ?? "").trim();
  const day = dateRaw
    ? parseTashkentDayStart(dateRaw)
    : parseTashkentDayStart(todayTashkentISO());
  if (!day) {
    redirect("/dolzhniki?err=date");
  }
  // End of that Tashkent day for repaidAt display consistency
  const repaidAt = new Date(day.getTime() + 12 * 60 * 60 * 1000); // noon Tashkent-ish on that day

  const back = safeReturnTo(formData.get("returnTo"));

  const result = await repayDebt(db, {
    debtId,
    actorId: actorId!,
    repaidAt,
  });

  if (!result.ok) {
    const code =
      result.error.code === "ALREADY_REPAID"
        ? "already"
        : result.error.code === "NOT_FOUND"
          ? "notfound"
          : result.error.code === "NOT_ACTIVE"
            ? "inactive"
            : "fail";
    redirect(`${back}${back.includes("?") ? "&" : "?"}err=${code}`);
  }

  revalidatePath("/dolzhniki");
  redirect(`${back}${back.includes("?") ? "&" : "?"}ok=repaid`);
}

/**
 * ТЗ №20 A §2.3 — платёж по долгу (по частям; по умолчанию весь остаток).
 * Владелец — любые долги; менеджер — долги своих продаж.
 */
export async function addDebtPaymentAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  const actorId = await currentActorId();
  if (!actorId || (!caps.canSeeDebts && !caps.canSell)) {
    redirect("/dolzhniki?err=denied");
  }
  const back = safeReturnTo(formData.get("returnTo"));
  const join = back.includes("?") ? "&" : "?";
  const debtId = String(formData.get("debtId") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(/\s/g, "").replace(",", "."));
  const method = String(formData.get("method") ?? "");
  const day = parseTashkentDayStart(String(formData.get("paidAt") ?? "") || todayTashkentISO());
  if (!debtId) redirect(`${back}${join}err=notfound`);
  if (!day) redirect(`${back}${join}err=date`);
  if (!Number.isFinite(amount) || amount <= 0 || !isPayMethod(method)) {
    redirect(`${back}${join}err=amount`);
  }
  if (!caps.canSeeDebts) {
    // менеджер — только долги своих продаж
    const own = await db.debt.findFirst({
      where: { id: debtId, saleRecord: { managerId: actorId } },
      select: { id: true },
    });
    if (!own) redirect(`${back}${join}err=denied`);
  }
  let code = "ok";
  try {
    await addDebtPayment(db, {
      debtId,
      amount,
      method: method as "CASH" | "CARD" | "TRANSFER",
      paidAt: new Date(day!.getTime() + 12 * 60 * 60 * 1000),
      actorId: actorId!,
    });
  } catch (e) {
    if (!(e instanceof PaymentError)) throw e;
    code = e.code === "OVERPAID" || e.code === "INVALID_INPUT" ? "amount" : e.code === "NOT_FOUND" ? "notfound" : "inactive";
  }
  revalidatePath("/dolzhniki");
  redirect(code === "ok" ? `${back}${join}ok=paid` : `${back}${join}err=${code}`);
}

/** ТЗ №20 A §2.4 — одна сумма клиента по нескольким долгам (раскладка из формы). */
export async function applyClientPaymentAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  const actorId = await currentActorId();
  if (!actorId || (!caps.canSeeDebts && !caps.canSell)) {
    redirect("/dolzhniki?err=denied");
  }
  const clientId = String(formData.get("clientId") ?? "").trim();
  const currency = String(formData.get("currency") ?? "") === "USD" ? "USD" : "UZS";
  const method = String(formData.get("method") ?? "");
  const day = parseTashkentDayStart(String(formData.get("paidAt") ?? "") || todayTashkentISO());
  const back = `/dolzhniki/klient/${encodeURIComponent(clientId)}?currency=${currency}`;
  const lines: { debtId: string; amountCents: number }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("alloc_")) continue;
    const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      redirect(`${back}&err=${encodeURIComponent("Суммы раскладки — неотрицательные числа")}`);
    }
    lines.push({ debtId: k.slice("alloc_".length), amountCents: toCents(n) });
  }
  if (!clientId || !day || !isPayMethod(method)) {
    redirect(`${back}&err=${encodeURIComponent("Проверьте способ и дату платежа")}`);
  }
  try {
    await applyClientPayment(db, {
      clientId,
      currency,
      lines,
      method: method as "CASH" | "CARD" | "TRANSFER",
      paidAt: new Date(day!.getTime() + 12 * 60 * 60 * 1000),
      actorId: actorId!,
      restrictManagerId: caps.canSeeDebts ? null : actorId,
    });
  } catch (e) {
    if (!(e instanceof PaymentError)) throw e;
    redirect(`${back}&err=${encodeURIComponent(e.message)}`);
  }
  revalidatePath("/dolzhniki");
  redirect(caps.canSeeDebts ? "/dolzhniki?ok=clientpaid" : `/klienty/${encodeURIComponent(clientId)}`);
}
