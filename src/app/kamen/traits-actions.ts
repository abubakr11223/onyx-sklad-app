"use server";

// ТЗ №20 K (§12.1) — ручная правка признаков узора / однородной партии.
// Правят все сотрудники (та же строка §15, что загрузка текстуры). После
// правки ИИ этот узор больше не перезаписывает (source = MANUAL). «История».

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { capabilitiesFor } from "@/lib/permissions";
import { parseManualTraits, saveManualTraits, type TraitsTarget } from "@/lib/traits-store";

export async function saveTraitsAction(formData: FormData): Promise<void> {
  const stoneTypeId = String(formData.get("stoneTypeId") ?? "");
  const back = (q: string): never => redirect(`/kamen/${encodeURIComponent(stoneTypeId)}?${q}#traits`);
  const user = await getCurrentUser();
  if (!user || !capabilitiesFor(user.role, { canSeePurchasePrice: false }).canUploadTexture) {
    back("trErr=denied");
  }
  const value = parseManualTraits({
    color: String(formData.get("color") ?? ""),
    tone: String(formData.get("tone") ?? ""),
    pattern: String(formData.get("pattern") ?? ""),
    veinColor: String(formData.get("veinColor") ?? ""),
  });
  if (!value) back("trErr=bad");

  // Цель — узор или партия БЕЗ узоров этого вида (подделанный id не пройдёт).
  const patternId = String(formData.get("batchPatternId") ?? "");
  const batchId = String(formData.get("batchId") ?? "");
  let target: TraitsTarget | null = null;
  if (patternId) {
    const p = await db.batchPattern.findFirst({
      where: { id: patternId, batch: { stoneTypeId } },
      select: { id: true },
    });
    if (p) target = { stoneTypeId, batchId: null, batchPatternId: p.id };
  } else if (batchId) {
    const b = await db.batch.findFirst({
      where: { id: batchId, stoneTypeId, patterns: { none: {} } },
      select: { id: true },
    });
    if (b) target = { stoneTypeId, batchId: b.id, batchPatternId: null };
  }
  if (!target) back("trErr=bad");

  await saveManualTraits(db, { target: target!, value: value!, actorId: user!.id });
  revalidatePath(`/kamen/${stoneTypeId}`);
  back("trOk=1");
}
