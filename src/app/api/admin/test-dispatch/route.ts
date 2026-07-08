// VAQTINCHALIK himoyalangan test-trigger: TG-B1 fotozapros oqimini login'siz
// sinash uchun. Guard: TELEGRAM_WEBHOOK_SECRET (timing-safe). Birinchi menejer +
// birinchi partiya bo'yicha fotozapros yaratib, skladchi(lar)ga TG vazifa yuboradi.
// ⚠️ FOLLOW-UP: sinov tugagach seed + test-dispatch endpoint'larini O'CHIRISH.
import { db } from "@/lib/db";
import { sendMessage } from "@/lib/telegram";
import { createAndDispatchPhotoRequest } from "@/lib/photo-requests";

export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  const aB = new TextEncoder().encode(a);
  const bB = new TextEncoder().encode(b);
  let diff = aB.length ^ bB.length;
  for (let i = 0; i < aB.length; i++) diff |= aB[i] ^ (i < bB.length ? bB[i] : 0);
  return diff === 0;
}

export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !timingSafeEqual(req.headers.get("x-seed-secret") ?? "", expected)) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const manager = await db.user.findFirst({
      where: { role: "MANAGER", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const batch = await db.batch.findFirst({
      orderBy: { arrivedAt: "asc" },
      include: { locations: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    if (!manager || !batch) {
      return Response.json(
        { ok: false, error: "Menejer yoki partiya yo'q — avval /api/admin/seed" },
        { status: 400 },
      );
    }

    const result = await createAndDispatchPhotoRequest(
      {
        managerId: manager.id,
        batchId: batch.id,
        batchLocationId: batch.locations[0]?.id ?? null,
        comment: "Тестовый запрос (демо)",
      },
      { db, sendMessage },
    );

    return Response.json({
      ok: true,
      requestId: result.request.id,
      dispatchedTo: result.dispatchedTo,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
