"use server";

// TZ №9 Part B — repay debt (full only). Domain: src/lib/debts.ts (o1).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { repayDebt } from "@/lib/debts";
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
