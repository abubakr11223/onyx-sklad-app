"use client";

// Форма «Разбить камень» (TZ §5.6, §6.4) — складчик с телефона:
// крупные поля, минимум текста, шаг подтверждения перед записью.

import { useActionState, useRef, useState } from "react";
import { submitBreak, type BreakFormState } from "./actions";

export interface SlabOption {
  id: string;
  label: string;
  stoneName: string;
  reserved: boolean;
  block: string;
  landmark: string;
}

export interface BatchOption {
  id: string;
  stoneName: string;
  arrived: string; // уже отформатированная дата
  qty: string; // «40 плит / 220 м²»
}

const initialState: BreakFormState = { errors: {} };

const inputCls =
  "h-14 w-full rounded-xl border border-gray-300 bg-white px-4 text-lg " +
  "focus:border-gray-900 focus:outline-none";
const labelCls = "mb-1 block text-base font-medium text-gray-700";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-sm font-medium text-red-600">{msg}</p>;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = map.get(k);
    if (group) group.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export default function BreakForm({
  slabs,
  batches,
}: {
  slabs: SlabOption[];
  batches: BatchOption[];
}) {
  const [state, formAction, pending] = useActionState(submitBreak, initialState);
  const [mode, setMode] = useState<"slab" | "direct">("slab");
  const [soldPart, setSoldPart] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const nextRowId = useRef(1);
  const e = state.errors;

  const addRow = () => setRowIds((ids) => [...ids, nextRowId.current++]);
  const removeRow = (id: number) =>
    setRowIds((ids) => (ids.length > 1 ? ids.filter((x) => x !== id) : ids));

  const toggleCls = (active: boolean) =>
    `h-12 flex-1 rounded-xl text-base font-semibold transition-colors ${
      active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
    }`;

  const slabGroups = groupBy(slabs, (s) => s.stoneName);
  const batchGroups = groupBy(batches, (b) => b.stoneName);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <FieldError msg={e.form} />
      <input type="hidden" name="mode" value={mode} />

      {/* ── Что разбиваем ── */}
      <section className="rounded-2xl bg-gray-50 p-4">
        <h2 className="mb-3 text-lg font-semibold">Что разбиваем</h2>
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            className={toggleCls(mode === "slab")}
            onClick={() => setMode("slab")}
          >
            Плита
          </button>
          <button
            type="button"
            className={toggleCls(mode === "direct")}
            onClick={() => setMode("direct")}
          >
            Бой в партии
          </button>
        </div>

        {mode === "slab" ? (
          <div>
            <label htmlFor="slabId" className={labelCls}>
              Плита <span className="text-red-600">*</span>
            </label>
            <select id="slabId" name="slabId" className={inputCls} defaultValue="">
              <option value="" disabled>
                — выберите плиту —
              </option>
              {[...slabGroups.entries()].map(([stone, group]) => (
                <optgroup key={stone} label={stone}>
                  {group.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} — блок {s.block}, ориентир {s.landmark}
                      {s.reserved ? " · есть бронь — менеджер будет уведомлён" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <FieldError msg={e.slabId} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="batchId" className={labelCls}>
                Партия <span className="text-red-600">*</span>
              </label>
              <select id="batchId" name="batchId" className={inputCls} defaultValue="">
                <option value="" disabled>
                  — выберите партию —
                </option>
                {[...batchGroups.entries()].map(([stone, group]) => (
                  <optgroup key={stone} label={stone}>
                    {group.map((b) => (
                      <option key={b.id} value={b.id}>
                        от {b.arrived} — {b.qty}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <FieldError msg={e.batchId} />
            </div>
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 text-base">
              <input
                type="checkbox"
                name="decrementSlabs"
                value="1"
                defaultChecked
                className="h-6 w-6 accent-gray-900"
              />
              Это была целая плита партии (списать плиту)
            </label>
          </div>
        )}
      </section>

      {/* ── Куски ── */}
      <section className="rounded-2xl bg-gray-50 p-4">
        <h2 className="mb-1 text-lg font-semibold">Куски</h2>
        <p className="mb-3 text-sm text-gray-500">
          Размеры каждой стороны в мм через запятую. Фото и AI-чертёж появятся в
          следующем этапе — пока размеры вносятся вручную.
        </p>
        <FieldError msg={e.pieces} />
        <div className="flex flex-col gap-4">
          {rowIds.map((id, idx) => (
            <div key={id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-base font-semibold text-gray-700">Кусок {idx + 1}</span>
                {rowIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(id)}
                    className="h-10 rounded-lg px-3 text-base font-medium text-red-600"
                  >
                    Убрать
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label className={labelCls}>
                    Тип <span className="text-red-600">*</span>
                  </label>
                  <select name="pKind" className={inputCls} defaultValue="BROKEN">
                    <option value="BROKEN">Бой</option>
                    <option value="OFFCUT">Остаток</option>
                  </select>
                  <FieldError msg={e[`p-${idx}-kind`]} />
                </div>
                <div>
                  <label className={labelCls}>
                    Стороны, мм <span className="text-red-600">*</span>
                  </label>
                  <input
                    name="pSides"
                    inputMode="numeric"
                    className={inputCls}
                    placeholder="1180, 640, 950, 610"
                  />
                  <FieldError msg={e[`p-${idx}-sidesMm`]} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>
                      Длина, мм <span className="text-red-600">*</span>
                    </label>
                    <input name="pBoundLen" inputMode="numeric" className={inputCls} placeholder="1180" />
                    <FieldError msg={e[`p-${idx}-boundingLengthMm`]} />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Ширина, мм <span className="text-red-600">*</span>
                    </label>
                    <input name="pBoundWidth" inputMode="numeric" className={inputCls} placeholder="640" />
                    <FieldError msg={e[`p-${idx}-boundingWidthMm`]} />
                  </div>
                  <div>
                    <label className={labelCls}>Толщина, мм</label>
                    <input name="pThickness" inputMode="numeric" className={inputCls} placeholder="20" />
                    <FieldError msg={e[`p-${idx}-thicknessMm`]} />
                  </div>
                  <div>
                    <label className={labelCls}>Площадь, м²</label>
                    <input name="pArea" inputMode="decimal" className={inputCls} placeholder="0,6" />
                    <FieldError msg={e[`p-${idx}-areaM2`]} />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Блок <span className="text-red-600">*</span>
                    </label>
                    <input name="pBlock" className={inputCls} placeholder="А" />
                    <FieldError msg={e[`p-${idx}-block`]} />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Ориентир <span className="text-red-600">*</span>
                    </label>
                    <input name="pLandmark" className={inputCls} placeholder="2 или 1–2" />
                    <FieldError msg={e[`p-${idx}-landmark`]} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="mt-3 h-12 w-full rounded-xl border-2 border-dashed border-gray-300 text-base font-semibold text-gray-600"
        >
          + Добавить кусок
        </button>
      </section>

      {/* ── Распил: часть ушла клиенту (только для плиты) ── */}
      {mode === "slab" && (
        <section className="rounded-2xl bg-gray-50 p-4">
          <label className="flex min-h-12 items-center gap-3 text-base font-medium">
            <input
              type="checkbox"
              name="soldPart"
              value="1"
              checked={soldPart}
              onChange={(ev) => setSoldPart(ev.target.checked)}
              className="h-6 w-6 accent-gray-900"
            />
            Часть ушла клиенту / в изделие (распил)
          </label>
          {soldPart && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-gray-500">
                Факт попадёт в журнал. Продажу оформляет менеджер в разделе продаж.
              </p>
              <div>
                <label htmlFor="soldCustomerName" className={labelCls}>
                  Кому <span className="text-red-600">*</span>
                </label>
                <input
                  id="soldCustomerName"
                  name="soldCustomerName"
                  className={inputCls}
                  placeholder="Клиент / заказ"
                />
                <FieldError msg={e.soldCustomerName} />
              </div>
              <div>
                <label htmlFor="soldPrice" className={labelCls}>
                  Цена (если известна)
                </label>
                <input
                  id="soldPrice"
                  name="soldPrice"
                  inputMode="decimal"
                  className={inputCls}
                  placeholder="250"
                />
                <FieldError msg={e.soldPrice} />
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Шаг подтверждения ── */}
      {confirming ? (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="mb-3 text-base font-semibold text-amber-900">
            Проверьте данные выше.{" "}
            {mode === "slab"
              ? "Плита будет переведена в «Бой / остаток» — вернуть её обратно нельзя."
              : "Бой будет записан в партию и спишется из её остатка."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-14 flex-1 rounded-xl bg-gray-200 text-lg font-semibold text-gray-700"
            >
              Назад
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-14 flex-1 rounded-xl bg-gray-900 text-lg font-bold text-white disabled:opacity-50"
            >
              {pending ? "Запись…" : "Подтвердить"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-16 rounded-2xl bg-gray-900 text-xl font-bold text-white"
        >
          Продолжить
        </button>
      )}
    </form>
  );
}
