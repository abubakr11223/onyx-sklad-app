"use client";

// Форма новой брони (TZ §6.6): вид камня → конкретная плита / остаток /
// объём из партии → клиент и срок. Крупные touch-поля — менеджер с телефона.

import { useActionState, useState } from "react";
import { createReservation, type ReserveFormState } from "./actions";

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

const inputCls =
  "h-14 w-full rounded-xl border border-gray-300 bg-white px-4 text-lg " +
  "focus:border-gray-900 focus:outline-none";
const labelCls = "mb-1 block text-base font-medium text-gray-700";

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-sm font-medium text-red-600">{msg}</p>;
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
      <p className="text-gray-500">
        Нет камня, доступного для брони: все плиты и остатки заняты, свободного
        объёма в партиях нет.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FieldError msg={e.form} />

      <div>
        <label htmlFor="bron-stone" className={labelCls}>
          Вид камня <span className="text-red-600">*</span>
        </label>
        <select
          id="bron-stone"
          className={inputCls}
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
      </div>

      {stone && (
        <div>
          <label htmlFor="bron-target" className={labelCls}>
            Что бронируем <span className="text-red-600">*</span>
          </label>
          <select
            id="bron-target"
            name="target"
            className={inputCls}
            value={target}
            onChange={(ev) => setTarget(ev.target.value)}
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
          <FieldError msg={e.target} />
        </div>
      )}

      {isBatch && (
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="mb-2 text-sm text-amber-900">
            Свободно под бронь: {freeParts.length > 0 ? freeParts.join(" · ") : "нет данных"}.
            Укажите плиты и/или м².
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bron-qty-slabs" className={labelCls}>
                Плит
              </label>
              <input
                id="bron-qty-slabs"
                name="qtySlabs"
                inputMode="numeric"
                className={inputCls}
                placeholder="10"
              />
              <FieldError msg={e.qtySlabs} />
            </div>
            <div>
              <label htmlFor="bron-qty-area" className={labelCls}>
                м²
              </label>
              <input
                id="bron-qty-area"
                name="qtyAreaM2"
                inputMode="decimal"
                className={inputCls}
                placeholder="55 или 12,5"
              />
              <FieldError msg={e.qtyAreaM2} />
            </div>
          </div>
        </div>
      )}

      <div>
        <label htmlFor="bron-customer" className={labelCls}>
          Клиент <span className="text-red-600">*</span>
        </label>
        <input
          id="bron-customer"
          name="customerName"
          className={inputCls}
          placeholder="Иван Петров"
        />
        <FieldError msg={e.customerName} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="bron-contact" className={labelCls}>
            Контакт
          </label>
          <input
            id="bron-contact"
            name="customerContact"
            className={inputCls}
            placeholder="+998 …"
          />
        </div>
        <div>
          <label htmlFor="bron-days" className={labelCls}>
            Срок, дней
          </label>
          <input
            id="bron-days"
            name="days"
            inputMode="numeric"
            className={inputCls}
            placeholder={`по умолчанию ${defaultDays}`}
          />
          <FieldError msg={e.days} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending || !target}
        className="h-16 rounded-2xl bg-gray-900 text-xl font-bold text-white disabled:opacity-50"
      >
        {pending ? "Бронирование…" : "Забронировать"}
      </button>
    </form>
  );
}
