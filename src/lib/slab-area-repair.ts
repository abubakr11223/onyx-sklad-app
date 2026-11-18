// ТЗ №21 А1 — пересчёт уже записанных остатков после исправления.
//
// Раньше продажа ПЛИТАМИ (BATCH_VOLUME, qtySlabs > 0, qtyAreaM2 = null)
// уменьшала только число плит: площадь узора и партии оставалась прежней
// (узоры — до ТЗ №19, однородные партии — до ТЗ №21). Здесь — план починки:
// для каждой такой продажи площадь = N × площадь плиты (узора или партии),
// усечение до 3 знаков. Списывается только то, что ещё продано (без
// возвращённых плит). Чистая функция — без БД; запись — в CLI.

export interface RepairSaleRow {
  id: string;
  soldAt: Date;
  qtySlabs: number;
  returnedSlabs: number;
  batchId: string;
  batchPatternId: string | null;
  /** Площадь одной плиты, м² (узора — по габариту/средней, партии — так же). */
  unitAreaM2: number;
  label: string;
}

export interface RepairPlanItem {
  saleId: string;
  label: string;
  soldAt: Date;
  batchId: string;
  batchPatternId: string | null;
  /** SaleRecord.qtyAreaM2 = qtySlabs × S. */
  saleAreaM2: number;
  /** SaleRecord.returnedAreaM2 = returnedSlabs × S. */
  returnedAreaM2: number;
  /** На сколько увеличить areaSoldM2 узора / areaSoldDirectM2 партии. */
  addSoldAreaM2: number;
}

const trunc3 = (v: number) => Math.floor(v * 1000 + 1e-6) / 1000;

export function planSlabAreaRepair(rows: readonly RepairSaleRow[]): RepairPlanItem[] {
  const out: RepairPlanItem[] = [];
  for (const r of rows) {
    if (r.qtySlabs <= 0 || r.unitAreaM2 <= 0) continue;
    const kept = Math.max(0, r.qtySlabs - r.returnedSlabs);
    out.push({
      saleId: r.id,
      label: r.label,
      soldAt: r.soldAt,
      batchId: r.batchId,
      batchPatternId: r.batchPatternId,
      saleAreaM2: trunc3(r.qtySlabs * r.unitAreaM2),
      returnedAreaM2: trunc3(Math.min(r.returnedSlabs, r.qtySlabs) * r.unitAreaM2),
      addSoldAreaM2: trunc3(kept * r.unitAreaM2),
    });
  }
  return out;
}

export function formatRepairPlan(plan: readonly RepairPlanItem[]): string {
  if (plan.length === 0) return "Исправлять нечего: все продажи плитами уже списали площадь.";
  const lines = plan.map(
    (p) =>
      `• ${p.soldAt.toISOString().slice(0, 10)}  ${p.label}  — площадь продажи ${p.saleAreaM2} м², ` +
      `вернуть в учёт продано +${p.addSoldAreaM2} м²` +
      (p.returnedAreaM2 > 0 ? ` (возвращено ${p.returnedAreaM2} м²)` : ""),
  );
  const total = plan.reduce((n, p) => n + p.addSoldAreaM2, 0);
  return [...lines, `Итого продаж: ${plan.length}; списать площади: ${trunc3(total)} м²`].join("\n");
}
