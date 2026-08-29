"use client";

// Форма новой брони (TZ §6.6): вид камня → конкретная плита / остаток /
// объём из партии → клиент и срок. Крупные touch-поля — менеджер с телефона.
// C-pilot: разметка переведена на бренд-дизайн-систему (Button/Field/Alert).
// Поведение, имена полей и контракт валидации НЕ менялись.

import { useActionState, useState } from "react";
import {
  createReservation,
  type ReserveFormState,
} from "./actions";
import {
  reserveErrorItems,
  reserveRenderedKeys,
} from "./reserve-form-errors";
import {
  emptyReserveValues,
  nextReserveValues,
  type ReserveValues,
} from "./reserve-form-values";
import { leftoverErrorMessages } from "@/lib/form-errors";
import type { ReservationAlternative } from "@/lib/reservations";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";
import Alert from "@/components/ui/Alert";

export interface UnitOption {
  /** "SLAB:<id>" | "PIECE:<id>" | "BATCH:<id>" */
  value: string;
  label: string;
}

export interface BatchVolumeOption extends UnitOption {
  /** null = нет данных по этому измерению (учёт отключён, §3). */
  freeSlabs: number | null;
  freeAreaM2: number | null;
}

export interface StoneGroup {
  id: string;
  name: string;
  rockType: string;
  slabs: UnitOption[];
  pieces: UnitOption[];
  batches: BatchVolumeOption[];
}

const initialState: ReserveFormState = { errors: {}, alternatives: [] };

function alternativeLine(a: ReservationAlternative): string {
  const parts = [a.stoneTypeName, a.kindRu];
  if (a.detail) parts.push(a.detail);
  if (a.place) parts.push(a.place);
  if (a.freeText) parts.push(a.freeText);
  if (a.inStockLabel) parts.push(a.inStockLabel);
  return parts.join(" · ");
}

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** Звёздочка «обязательное поле». */
function Req() {
  return <span className="text-danger">*</span>;
}

export default function ReserveForm({
  stones,
  defaultDays,
}: {
  stones: StoneGroup[];
  defaultDays: number;
}) {
  const [state, formAction, pending] = useActionState(
    createReservation,
    initialState,
  );
  const [stoneId, setStoneId] = useState("");
  const [target, setTarget] = useState("");
  // W3-T1: управляемые поля — переживают отказ сервера (React 19 сбрасывает
  // только неуправляемые). Сброс делаем сами и только на успехе.
  const [values, setValues] = useState<ReserveValues>(emptyReserveValues);
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    // Правка состояния во время рендера (штатный приём React), а не эффект:
    // ответ сервера уже пришёл, лишнего кадра со «старыми» полями не будет.
    setSeenState(state);
    setValues((prev) => nextReserveValues(prev, state));
  }
  const setValue = (key: keyof ReserveValues) => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));
  const e = state.errors;

  const stone = stones.find((s) => s.id === stoneId) ?? null;
  const isBatch = target.startsWith("BATCH:");
  const batchOption = isBatch
    ? (stone?.batches.find((b) => b.value === target) ?? null)
    : null;

  const freeParts: string[] = [];
  if (batchOption?.freeSlabs != null)
    freeParts.push(`плит ~${batchOption.freeSlabs}`);
  if (batchOption?.freeAreaM2 != null)
    freeParts.push(`≈${m2Fmt.format(batchOption.freeAreaM2)} м²`);

  if (stones.length === 0) {
    return (
      <p className="text-ink/70">
        Нет камня, доступного для брони: все плиты и остатки заняты, свободного
        объёма в партиях нет.
      </p>
    );
  }

  const alternatives = state.alternatives ?? [];

  // Structural leftover: unmounted target/qty + unknown keys never silent.
  // Preferred list always includes target/qty*; mount-aware leftovers add
  // anything not on a live Field (e.g. target when stone not chosen).
  const bannerItems = reserveErrorItems(e);
  const mountLeftovers = leftoverErrorMessages(
    e,
    reserveRenderedKeys({
      stoneSelected: Boolean(stone),
      isBatch,
    }),
  );
  // Merge: full preferred order, plus any mount-only gap already covered by
  // preferred keys (target/qty are in RESERVE_FORM_ERROR_KEYS).
  const errorBanner = [
    ...new Set([...bannerItems, ...mountLeftovers]),
  ];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {errorBanner.length > 0 && (
        <Alert variant="danger" title="Бронь не оформлена">
          {errorBanner.length === 1 ? (
            <p className="text-base font-semibold">{errorBanner[0]}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {errorBanner.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {/* TZ §7: отказ брони не «глухой» — похожие AVAILABLE (не авто-бронь). */}
      {alternatives.length > 0 && (
        <Alert variant="info" title="Похожие варианты в наличии">
          <p className="mb-2 text-sm text-ink/70">
            Выбранный камень недоступен. Можно предложить клиенту другое — нажмите,
            чтобы подставить в форму (бронь не создаётся сама).
          </p>
          <ul className="flex flex-col gap-1.5">
            {alternatives.map((a) => (
              <li key={a.target}>
                <button
                  type="button"
                  className="w-full rounded-field border border-line bg-paper-2 px-3 py-2 text-left text-sm font-medium text-ink transition hover:border-gold hover:text-gold-deep"
                  onClick={() => {
                    // target = "SLAB:id" | "PIECE:id" | "BATCH:id"
                    const stone = stones.find(
                      (s) =>
                        s.slabs.some((o) => o.value === a.target) ||
                        s.pieces.some((o) => o.value === a.target) ||
                        s.batches.some((o) => o.value === a.target),
                    );
                    if (stone) setStoneId(stone.id);
                    setTarget(a.target);
                  }}
                >
                  {alternativeLine(a)}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* ── Вид камня (клиентский фильтр — без name, не уходит на сервер) ── */}
      <Field id="bron-stone" label={<>Вид камня <Req /></>}>
        <select
          id="bron-stone"
          className={inputClass}
          value={stoneId}
          onChange={(ev) => {
            setStoneId(ev.target.value);
            setTarget("");
          }}
        >
          <option value="" disabled>
            — выберите вид —
          </option>
          {stones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.rockType})
            </option>
          ))}
        </select>
      </Field>

      {stone && (
        <Field id="bron-target" label={<>Что бронируем <Req /></>} error={e.target}>
          <select
            id="bron-target"
            name="target"
            className={inputClass}
            value={target}
            onChange={(ev) => setTarget(ev.target.value)}
            aria-invalid={e.target ? true : undefined}
            aria-describedby={e.target ? "bron-target-error" : undefined}
          >
            <option value="" disabled>
              — выберите плиту, остаток или объём —
            </option>
            {stone.slabs.length > 0 && (
              <optgroup label="Плиты">
                {stone.slabs.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            )}
            {stone.pieces.length > 0 && (
              <optgroup label="Бой и остатки">
                {stone.pieces.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            )}
            {stone.batches.length > 0 && (
              <optgroup label="Объём из партии (B2B)">
                {stone.batches.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      )}

      {/* Объём из партии — «требует ввода количества»: янтарный caution-блок. */}
      {isBatch && (
        <div className="rounded-card border border-warning/40 bg-warning/10 p-4">
          <p className="mb-3 text-sm text-warning">
            Свободно под бронь:{" "}
            {freeParts.length > 0 ? freeParts.join(" · ") : "нет данных"}. Укажите
            плиты и/или м².
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="bron-qty-slabs"
              name="qtySlabs"
              inputMode="numeric"
              label="Плит"
              placeholder="10"
              value={values.qtySlabs}
              onChange={(ev) => setValue("qtySlabs")(ev.target.value)}
              error={e.qtySlabs}
            />
            <Field
              id="bron-qty-area"
              name="qtyAreaM2"
              inputMode="decimal"
              label="м²"
              placeholder="55 или 12,5"
              value={values.qtyAreaM2}
              onChange={(ev) => setValue("qtyAreaM2")(ev.target.value)}
              error={e.qtyAreaM2}
            />
          </div>
        </div>
      )}

      <Field
        id="bron-customer"
        name="customerName"
        label={<>Клиент <Req /></>}
        placeholder="Иван Петров"
        value={values.customerName}
        onChange={(ev) => setValue("customerName")(ev.target.value)}
        error={e.customerName}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field
          id="bron-contact"
          name="customerContact"
          label="Контакт"
          placeholder="+998 …"
          value={values.customerContact}
          onChange={(ev) => setValue("customerContact")(ev.target.value)}
        />
        <Field
          id="bron-days"
          name="days"
          inputMode="numeric"
          label="Срок, дней"
          placeholder={`по умолчанию ${defaultDays}`}
          value={values.days}
          onChange={(ev) => setValue("days")(ev.target.value)}
          error={e.days}
        />
      </div>

      {/* CTA — в обычном потоке (НЕ sticky): форма «Новая бронь» встроена в
          середину страницы (над ней Активные брони, под ней История), поэтому
          липкая панель наезжала бы на Историю при скролле. Реальный submit
          формы (без JS) сохраняется — устойчивость к слабой сети. */}
      <div className="mt-2">
        <Button
          type="submit"
          disabled={pending || !target}
          className="min-h-14 w-full text-lg font-bold"
        >
          {pending ? "Бронирование…" : "Забронировать"}
        </Button>
      </div>
    </form>
  );
}
