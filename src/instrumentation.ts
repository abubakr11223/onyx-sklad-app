// Next.js `instrumentation` — register() har server jarayoni ishga tushganda
// BIR MARTA chaqiriladi (Next 15+ da barqaror, config flag KERAK EMAS).
//
// SABAB (pm2, Vercel EMAS): production self-hosted pm2 ostida ishlaydi, shu bois
// `vercel.json` dagi Vercel Cron HECH QACHON ishlamaydi → muddati o'tgan bronlar
// backstop'i o'lik edi. Bu yerda `node-cron` bilan JARAYON-ICHIDA jadval quramiz:
// doimiy pm2 Node jarayonining o'zi har 15 daqiqada sweep yuritadi.
//
// KLASTER HIMOYASI: pm2 `cluster` rejimida N nusxa ishga tushishi mumkin. Har
// nusxada jadval qursak — sweep N marta yuritiladi (isrof; expireOverdive...
// idempotent bo'lgani uchun XAVFSIZ, lekin keraksiz). pm2 har nusxaga
// `NODE_APP_INSTANCE` (0..N-1) beradi — faqat "0" (yoki umuman berilmagan, ya'ni
// fork/bitta-nusxa rejim) da jadval quramiz.
//
// Endpoint /api/cron/expire-reservations O'CHIRILMAGAN (qo'lda/tashqi cron uchun),
// /bron va /fotozapros'dagi lazy sweep ham qoladi — bu qo'shimcha himoya qatlami.

/**
 * Berilgan muhitda (env) jadval qurish kerakmi. Sof funksiya — alohida testlanadi.
 * - NEXT_RUNTIME === "edge" → yo'q (edge bundle'da DB/cron yo'q).
 *   ⚠️ MUHIM: standalone `node server.js` (repo prod yo'li: output:standalone +
 *   Dockerfile) da `NEXT_RUNTIME` UMUMAN o'rnatilmaydi (undefined). Shuning uchun
 *   guard "nodejs bo'lsagina" EMAS, "edge bo'lmasagina" — aks holda cron prod'da
 *   jimgina o'lik bo'lardi. `next start` da NEXT_RUNTIME="nodejs" — u ham o'tadi.
 * - NODE_APP_INSTANCE berilgan va "0" emas → yo'q (klaster nusxasi).
 * - Aks holda (instance "0", "" yoki umuman yo'q) → ha.
 */
export function shouldScheduleSweep(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NEXT_RUNTIME === "edge") return false;
  const instance = env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== "" && instance !== "0") {
    return false;
  }
  return true;
}

/** Sweep jadvali (cron ifodasi) — har 15 daqiqada. */
export const SWEEP_CRON_EXPRESSION = "*/15 * * * *";

export async function register(): Promise<void> {
  // ⚠️ EDGE-BUNDLE HIMOYASI: node-cron (→ node:crypto) edge funksiyaga
  // TORTILMASLIGI shart, aks holda Vercel edge-build "unsupported module
  // node:crypto" bilan yiqiladi. LITERAL `=== "edge"` tekshiruvi edge bundle'da
  // "edge"==="edge" → erta return; quyidagi dinamik import esa O'LIK-KOD sifatida
  // butunlay olib tashlanadi (funksiya-guard `shouldScheduleSweep()` buni qila
  // olmasdi — bundler uni statik hisoblay olmaydi). Standalone `node server.js`
  // (repo prod yo'li) da NEXT_RUNTIME UNDEFINED — u "edge" emas, demak cron
  // ISHLAYDI; klaster/instance himoyasi esa reservation-cron ichida.
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { scheduleReservationSweep } = await import("./reservation-cron");
  scheduleReservationSweep();
}
