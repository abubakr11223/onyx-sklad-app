// BIR MARTALIK himoyalangan seed-endpoint (test uchun). TG fotozapros oqimini
// prod'da sinash uchun demo ma'lumot yozadi. Guard: TELEGRAM_WEBHOOK_SECRET
// (mavjud sirni qayta ishlatamiz — yangi env qo'shmaslik uchun). Timing-safe.
// ⚠️ FOLLOW-UP: test tugagach bu endpoint'ni O'CHIRISH kerak.
import { db } from "@/lib/db";
import { seedDemoData } from "@/lib/seed-demo";

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
  if (!expected || expected.length === 0) {
    return new Response("unauthorized", { status: 401 });
  }
  const got = req.headers.get("x-seed-secret") ?? "";
  if (!timingSafeEqual(got, expected)) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* bo'sh tana — ruxsat */
  }
  const warehouseTelegramId =
    typeof body === "object" && body !== null && typeof (body as { warehouseTelegramId?: unknown }).warehouseTelegramId === "string"
      ? (body as { warehouseTelegramId: string }).warehouseTelegramId
      : undefined;

  try {
    const result = await seedDemoData(db, { warehouseTelegramId });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    // Diagnostika (vaqtincha): xatoni qaytaramiz — endpoint secret bilan himoyalangan.
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        name: e instanceof Error ? e.name : undefined,
        stack: e instanceof Error ? e.stack?.slice(0, 1500) : undefined,
      },
      { status: 500 },
    );
  }
}
