// Zaxira nusxasini TASHQI saqlagichga olib ketish uchun eksport.
//
// /api/cron/backup zaxirani Telegram'ga yuboradi; bu endpoint esa o'sha
// snapshot'ni JSON qilib qaytaradi, shunda kunlik Cowork vazifasi uni tortib
// olib Google Drive'ga (to'liq nusxa) va Google Sheets'ga (ko'z bilan ko'rish
// uchun asosiy jadvallar) yozadi. Ikki qatlam: biri telefonda, biri Drive'da.
//
// Faqat o'qiydi, hech narsani o'zgartirmaydi. Himoya — cron bilan bir xil
// `Authorization: Bearer <CRON_SECRET>`; kalitsiz 401.
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  buildSnapshot,
  snapshotFilename,
  snapshotToJson,
} from "@/lib/db-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req, "export/snapshot")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const takenAt = new Date().toISOString();
  const snapshot = await buildSnapshot(db, takenAt);

  return new Response(snapshotToJson(snapshot), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${snapshotFilename(takenAt)}"`,
      "Cache-Control": "no-store",
    },
  });
}
