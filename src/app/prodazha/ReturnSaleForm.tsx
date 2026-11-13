"use client";

// ТЗ №20 F — форма «Оформить возврат» объёмной продажи. Сумма предлагается
// пропорционально (цена × доля) и пересчитывается при вводе количества, пока
// менеджер не поправил её руками. Окончательная проверка — на сервере
// (sale-returns.ts): количество ≤ остатка, сумма ≤ цена − уже возвращено.

import { useState } from "react";
import Button from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { PAY_METHODS, PAY_METHOD_LABEL } from "@/lib/payment-rows";
import { returnSalePartialAction } from "./actions";
import { normalizeMoneyForSubmit } from "./money-input";

export interface ReturnSaleFormProps {
  saleId: string;
  title: string;
  soldSlabs: number | null;
  soldAreaM2: number | null;
  remSlabs: number | null;
  remAreaM2: number | null;
  /** Цена продажи и уже возвращённая сумма, в центах (null — цены нет/скрыта). */
  priceCents: number | null;
  returnedCents: number;
  currency: "UZS" | "USD" | null;
}

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

function parseNum(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function money(cents: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, useGrouping: true })
    .format(cents / 100)
    .replace(/ | /g, " ");
}

export default function ReturnSaleForm(p: ReturnSaleFormProps) {
  const [slabs, setSlabs] = useState("");
  const [area, setArea] = useState("");
  const [refund, setRefund] = useState("");
  const [refundTouched, setRefundTouched] = useState(false);

  const bySlabs = p.soldSlabs !== null;
  const leftCents =
    p.priceCents === null ? null : Math.max(0, p.priceCents - p.returnedCents);

  // Предложение: доля по плитам (если продано плитами), иначе по м². Пусто = всё.
  const qSlabs = parseNum(slabs);
  const qArea = parseNum(area);
  let suggested: number | null = null;
  if (p.priceCents !== null && leftCents !== null) {
    const sold = bySlabs ? (p.soldSlabs ?? 0) : (p.soldAreaM2 ?? 0);
    const rem = bySlabs ? (p.remSlabs ?? 0) : (p.remAreaM2 ?? 0);
    const q = bySlabs ? (qSlabs ?? (qArea === null ? rem : null)) : (qArea ?? rem);
    if (q !== null && sold > 0) {
      suggested = q >= rem - 1e-6 ? leftCents : Math.min(leftCents, Math.round((p.priceCents * q) / sold));
    }
  }
  const shownRefund = refundTouched ? refund : suggested === null ? "" : money(suggested);

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-semibold text-honey-ink hover:underline">
        Оформить возврат
      </summary>
      <form action={returnSalePartialAction} className="mt-2 space-y-2 rounded-card border border-line p-3">
        <input type="hidden" name="saleRecordId" value={p.saleId} />
        <input type="hidden" name="currency" value={p.currency ?? ""} />
        <p className="text-xs font-semibold text-ink-2">
          Возврат · {p.title} · продано{" "}
          {[
            p.soldSlabs !== null && `${p.soldSlabs} плит`,
            p.soldAreaM2 !== null && `${m2Fmt.format(p.soldAreaM2)} м²`,
          ]
            .filter(Boolean)
            .join(" / ")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {p.soldSlabs !== null && (
            <label className="block text-sm text-ink-2">
              Вернуть плит (пусто = всё, ост. {p.remSlabs})
              <input
                name="qtySlabs"
                inputMode="numeric"
                value={slabs}
                onChange={(e) => setSlabs(e.target.value)}
                placeholder={String(p.remSlabs ?? "")}
                className={inputClass + " mt-1"}
              />
            </label>
          )}
          {p.soldAreaM2 !== null && (
            <label className="block text-sm text-ink-2">
              м² (пусто = {bySlabs ? "по плитам" : "всё"}, ост. {m2Fmt.format(p.remAreaM2 ?? 0)})
              <input
                name="qtyAreaM2"
                inputMode="decimal"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className={inputClass + " mt-1"}
              />
            </label>
          )}
        </div>
        {leftCents !== null && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm text-ink-2">
              Сумма возврата клиенту{p.currency === "USD" ? ", $" : ", сум"}
              <input
                inputMode="decimal"
                value={shownRefund}
                onChange={(e) => {
                  setRefundTouched(true);
                  setRefund(e.target.value);
                }}
                className={inputClass + " mt-1"}
              />
              <input type="hidden" name="refund" value={normalizeMoneyForSubmit(shownRefund)} />
              <span className="mt-1 block text-xs text-ink-3">
                не больше {money(leftCents)}; при долге сначала уменьшается долг
              </span>
            </label>
            <label className="block text-sm text-ink-2">
              Способ
              <select name="method" defaultValue="CASH" className={inputClass + " mt-1"}>
                {PAY_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAY_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <fieldset className="text-sm text-ink">
          <legend className="mb-1 text-ink-2">Куда камень</legend>
          <label className="mr-4 inline-flex items-center gap-1">
            <input type="radio" name="destination" value="SAME_PATTERN" defaultChecked /> в тот же
            узор/локацию
          </label>
          {bySlabs && (
            <label className="inline-flex items-center gap-1">
              <input type="radio" name="destination" value="REMAINDER" /> в бой/остаток
            </label>
          )}
        </fieldset>
        <label className="block text-sm text-ink-2">
          Причина
          <input name="reason" maxLength={500} className={inputClass + " mt-1"} />
        </label>
        <p className="text-xs text-ink-2">
          Не отгруженный камень вернётся в остаток сразу; отгруженный — после приёма
          складом в «Отгрузках».
        </p>
        <Button type="submit" variant="secondary" size="sm">
          Оформить возврат
        </Button>
      </form>
    </details>
  );
}
