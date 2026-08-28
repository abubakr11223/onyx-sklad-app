"use client";

// W1-T2 — форма «Оформить продажу» образца (вынесена из page.tsx).
// Раньше: неконтролируемая форма + redirect ?err — при ошибке валидации ввод
// терялся, ошибка уезжала в общий баннер страницы. Теперь — паттерн SaleForm:
// useActionState + контролируемые поля (React 19 не сбрасывает значения) и
// видимая ошибка у самой формы (Alert danger ⇒ role="alert").
// Цена — тот же money-input, что в SaleForm: показ с группировкой «1 500»,
// на сервер уходит нормализованное число (name="price" через hidden input).

import {
  useActionState,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";
import {
  applyMoneyInputChange,
  normalizeMoneyForSubmit,
} from "@/app/prodazha/money-input";
import type {
  PaymentMethod,
  SaleCurrency,
} from "@/lib/validators/sale-payment";
import { sellSampleAction } from "./actions";
import { emptySellSampleState } from "./sell-sample-state";

export default function SellSampleForm({ sampleId }: { sampleId: string }) {
  const [state, formAction, pending] = useActionState(
    sellSampleAction,
    emptySellSampleState(),
  );
  /** Display only — может содержать группировку («1 500»). */
  const [priceDisplay, setPriceDisplay] = useState("");
  /** Цифры для валидатора / hidden name="price" — никогда не с пробелами. */
  const [priceSubmit, setPriceSubmit] = useState("");
  const priceInputRef = useRef<HTMLInputElement>(null);
  const priceCaretRef = useRef<number | null>(null);
  const [currency, setCurrency] = useState<SaleCurrency>("UZS");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");

  // Restore caret after re-grouping (как в SaleForm: до отрисовки, без прыжка).
  useLayoutEffect(() => {
    const el = priceInputRef.current;
    const c = priceCaretRef.current;
    if (el && c !== null && document.activeElement === el) {
      el.setSelectionRange(c, c);
    }
    priceCaretRef.current = null;
  }, [priceDisplay]);

  const onPriceChange = (ev: ChangeEvent<HTMLInputElement>) => {
    const next = ev.target.value;
    const sel = ev.target.selectionStart;
    const { display, submit, caret } = applyMoneyInputChange(next, sel);
    priceCaretRef.current = caret;
    setPriceDisplay(display);
    setPriceSubmit(submit);
  };

  const e = state.errors;
  const banner = state.conflict ?? e.form;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-field border border-line bg-paper-2 p-2"
    >
      <input type="hidden" name="sampleId" value={sampleId} />
      <input
        type="hidden"
        name="price"
        value={priceSubmit || normalizeMoneyForSubmit(priceDisplay)}
      />
      <p className="text-xs font-semibold text-ink">Оформить продажу</p>
      {banner && (
        <Alert variant="danger" title="Ошибка">
          {banner}
        </Alert>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Field id={`price-${sampleId}`} label="Цена *" error={e.price}>
          <input
            ref={priceInputRef}
            id={`price-${sampleId}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="1 500"
            value={priceDisplay}
            onChange={onPriceChange}
            aria-invalid={e.price ? true : undefined}
            className={`${inputClass} tnum`}
          />
        </Field>
        <Field id={`cur-${sampleId}`} label="Валюта" error={e.currency}>
          <select
            id={`cur-${sampleId}`}
            name="currency"
            className={inputClass}
            value={currency}
            onChange={(ev) => setCurrency(ev.target.value as SaleCurrency)}
          >
            <option value="UZS">сум</option>
            <option value="USD">$</option>
          </select>
        </Field>
        <Field id={`pay-${sampleId}`} label="Оплата" error={e.paymentMethod}>
          <select
            id={`pay-${sampleId}`}
            name="paymentMethod"
            className={inputClass}
            value={paymentMethod}
            onChange={(ev) =>
              setPaymentMethod(ev.target.value as PaymentMethod)
            }
          >
            <option value="CASH">Наличные</option>
            <option value="CARD">Карта</option>
            <option value="CREDIT">В долг</option>
          </select>
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Оформляем…" : "Продать"}
      </Button>
    </form>
  );
}
