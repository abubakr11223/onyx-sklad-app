"use client";

// Форма новой брони (TZ §6.6): вид камня → конкретная плита / остаток /
// объём из партии → клиент и срок. Крупные touch-поля — менеджер с телефона.
// C-pilot: разметка переведена на бренд-дизайн-систему (Button/Field/Alert).
// Поведение, имена полей и контракт валидации НЕ менялись.

import { useActionState, useState } from "react";
import { createReservation, type ReserveFormState } from "./actions";
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

const initialState: ReserveFormState = { errors: {} };

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

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {e.form && <Alert variant="danger">{e.form}</Alert>}

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
              error={e.qtySlabs}
            />
            <Field
              id="bron-qty-area"
              name="qtyAreaM2"
              inputMode="decimal"
              label="м²"
              placeholder="55 или 12,5"
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
        error={e.customerName}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field
          id="bron-contact"
          name="customerContact"
          label="Контакт"
          placeholder="+998 …"
        />
        <Field
          id="bron-days"
          name="days"
          inputMode="numeric"
          label="Срок, дней"
          placeholder={`по умолчанию ${defaultDays}`}
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
