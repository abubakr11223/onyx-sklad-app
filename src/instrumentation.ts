// Next.js `instrumentation` — register() har server jarayoni ishga tushganda
// BIR MARTA chaqiriladi (Next 15+ da barqaror, config flag KERAK EMAS).
//
// ⚠️ TUZATISH (audit 2026-08-10). Bu yerda ilgari «production pm2 ostida
// ishlaydi, shuning uchun Vercel Cron HECH QACHON ishlamaydi» deb yozilgan edi.
// BU TESKARISI. `docs/deploy-vercel.md` aniq aytadi: Vercel — amaldagi
// production, VPS/pm2 esa «hozircha ishlatilmaydi» zaxira. Demak:
//
//   • Vercel'da (amaldagi holat) bu node-cron jadvali AMALDA ISHLAMAYDI:
//     serverless nusxa so'rovlar orasida o'ladi, u bilan birga taymer ham.
//     Haqiqiy backstop — `vercel.json` dagi cron, va u Hobby rejada KUNIGA
//     BIR MARTA (03:00 UTC) ishlaydi, 15 daqiqada emas.
//   • VPS/pm2 ga qaytilsa — quyidagi jadval o'sha zahoti kuchga kiradi.
//
// Ya'ni bu modul zarar qilmaydi va zaxira yo'l uchun saqlanadi, LEKIN uni
// «bronlar har 15 daqiqada tozalanadi» kafolati deb o'qish XATO.
// Amaldagi kafolat: (1) sotuv paytida muddat alohida tekshiriladi
// (`isHoldEffective` — eng muhimi), (2) /bron va /fotozapros ochilganda lazy
// sweep, (3) kunlik Vercel cron.
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
