// Rezervatsiya sweep cron jadvali — FAQAT nodejs runtime'da yuklanadi.
// instrumentation.ts → register() bu modulni `NEXT_RUNTIME !== "edge"` ostida
// DINAMIK import qiladi, shuning uchun node-cron bu yerda STATIK import qilingan
// bo'lsa ham EDGE bundle'ga hech qachon kirmaydi (edge'da import o'lik-kod).
//
// SABAB (pm2 / standalone): doimiy Node jarayoni har 15 daqiqada muddati o'tgan
// bronlarni tozalaydi. Vercel'da bu ishlamaydi (serverless) — u yerda
// vercel.json cron (/api/cron/expire-reservations) + /bron,/fotozapros lazy
// sweep himoya qatlamlari bor.
import * as cron from "node-cron";
import { shouldScheduleSweep, SWEEP_CRON_EXPRESSION } from "./instrumentation";

/**
 * node-cron jadvalini quradi. Klaster/instance dublikat himoyasi
 * (NODE_APP_INSTANCE) — shouldScheduleSweep'da; edge bo'lsa bu yerga umuman
 * yetib kelinmaydi (register() erta return qiladi).
 */
export function scheduleReservationSweep(): void {
  if (!shouldScheduleSweep()) return;

  cron.schedule(SWEEP_CRON_EXPRESSION, () => {
    void (async () => {
      // Import ham callback ichida — reject bo'lsa unhandledRejection jarayonni
      // yiqitmasin (Node ≥15 default). runReservationSweep o'zi throw qilmaydi,
      // lekin dinamik import xatosini ham shu yerda yutamiz.
      try {
        const { expireOverdueReservations } = await import("@/lib/reservations");
        const { runReservationSweep } = await import("@/lib/reservation-sweep");
        await runReservationSweep({ expire: expireOverdueReservations });
      } catch (err) {
        console.error("[instrumentation] sweep cron callback error:", err);
      }
    })();
  });

  console.info(
    `[instrumentation] reservation sweep cron scheduled ("${SWEEP_CRON_EXPRESSION}")`,
  );
}
