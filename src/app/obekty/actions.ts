"use server";

// TZ №10+11 §7 — действия раздела «Объекты».

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCapabilities, currentActorId } from "@/lib/session";
import { completeSiteRecord } from "@/lib/clients-directory";

export async function completeSiteAction(formData: FormData): Promise<void> {
  const caps = await getCapabilities();
  if (!caps.canSeeClients) {
    redirect("/obekty?err=denied");
  }
  const actorId = await currentActorId();
  const siteId = String(formData.get("siteId") ?? "").trim();
  if (!siteId) {
    redirect("/obekty?err=notfound");
  }

  const result = await completeSiteRecord(db, {
    siteId,
    canSeeAllClients: caps.canSeeAllClients,
    actorId,
  });

  if (!result.ok) {
    const code =
      result.code === "FORBIDDEN"
        ? "denied"
        : result.code === "ALREADY"
          ? "already"
          : result.code === "NOT_FOUND"
            ? "notfound"
            : "fail";
    redirect(`/obekty/${siteId}?err=${code}`);
  }

  revalidatePath("/obekty");
  revalidatePath(`/obekty/${siteId}`);
  revalidatePath("/klienty");
  redirect(`/obekty/${siteId}?ok=completed`);
}
