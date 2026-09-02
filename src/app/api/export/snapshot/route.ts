// Zaxira nusxasini TASHQI saqlagichga olib ketish uchun eksport.
//
// /api/cron/backup zaxirani Telegram'ga yuboradi. Bu endpoint esa o'sha
// zaxirani fayl qilib qaytaradi — Telegram'dan MUSTAQIL ikkinchi nusxa uchun.
// Ega serverida yoki alohida mashinada kuniga bir marta:
//
//   curl -fsS -H "Authorization: Bearer $EXPORT_SECRET" \
//        https://<domen>/api/export/snapshot -o /srv/backups/onyx-$(date +%F).json.gz
//
// Tafsilot va tekshirish tartibi — docs/zaxira.md.
//
// Audit 2026-09-02 shu yerda uchta narsani tuzatdi:
//   1. Kalit cron bilan UMUMIY edi. Eksport kaliti hujjatlardagi curl
//      misollarida ochiq turadi va terminal tarixida qoladi — biri sizib
//      chiqsa ikkinchisi ham ochilardi. Endi EXPORT_SECRET alohida; u
//      berilmasa CRON_SECRET ishlaydi (ko'chirishda hech narsa sinmasin).
//   2. Butun bazani yuklab olish HECH QAYERDA qayd etilmasdi. Endi har
//      chaqiruv jurnalga tizim amali sifatida tushadi.
//   3. Fayl xom JSON edi va bitta tranzaksiyasiz o'qilardi — ikkalasi ham
//      /api/cron/backup bilan bir xil yechim bilan tuzatildi.
import { db } from "@/lib/db";
import { isAuthorizedWith } from "@/lib/cron-auth";
import { packBackup, resolveBackupKey } from "@/lib/backup-file";
import { buildSnapshot, snapshotToJson, snapshotTotalRows } from "@/lib/db-snapshot";

import { SNAPSHOT_TX_OPTIONS } from "../../cron/backup/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** So'rovchi manzili — jurnalga yoziladi (kalit sizib chiqsa iz qolsin). */
function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorizedWith(req, "export/snapshot", "EXPORT_SECRET", "CRON_SECRET")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const takenAt = new Date().toISOString();
  const snapshot = await db.$transaction(
    (tx) => buildSnapshot(tx, takenAt),
    SNAPSHOT_TX_OPTIONS,
  );
  const packed = packBackup(snapshot, snapshotToJson, resolveBackupKey());

  // Jurnal — best-effort: yozilmasa ham eksport berilaveradi (aks holda
  // jurnal nosozligi zaxira olishni to'xtatib qo'yardi).
  try {
    await db.auditLog.create({
      data: {
        userId: null,
        action: "EXPORT",
        entityType: "Backup",
        entityId: packed.filename,
        payload: {
          bytes: packed.bytes.length,
          totalRows: snapshotTotalRows(snapshot),
          encrypted: packed.encrypted,
          redacted: packed.redacted,
          ip: clientIp(req),
          userAgent: req.headers.get("user-agent"),
        },
      },
    });
  } catch (e) {
    console.warn(
      `[export/snapshot] jurnal yozuvi qo'shilmadi: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return new Response(new Uint8Array(packed.bytes), {
    status: 200,
    headers: {
      // gzip'ni brauzer avtomatik ochib yubormasin: bu YUKLAB OLINADIGAN fayl,
      // uzatish siqilishi emas. Shuning uchun octet-stream.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${packed.filename}"`,
      "Content-Length": String(packed.bytes.length),
      "Cache-Control": "no-store",
      "X-Onyx-Encrypted": packed.encrypted ? "1" : "0",
    },
  });
}
